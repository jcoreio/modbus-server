const template = {
  AWSTemplateFormatVersion: '2010-09-09',
  Parameters: {
    KeyName: {
      Type: 'AWS::EC2::KeyPair::KeyName',
      Description: 'SSH key pair for accessing EC2 instance',
    },
    SubnetId: {
      Type: 'AWS::EC2::Subnet::Id',
      Description: 'Subnet for EC2 instance',
    },
    VpcId: {
      Type: 'AWS::EC2::VPC::Id',
      Description: 'VPC for creating security group',
    },
    InstanceType: {
      Type: 'String',
      Description: 'EC2 instance type',
    },
    AppAccessSecurityGroupId: {
      Type: 'String',
      Description: 'Security group for accessing application',
    },
    AppDockerImage: {
      Type: 'String',
      Description: 'Docker image for app container',
    },
    AppMemoryReservation: {
      Type: 'Number',
      Description: 'Memory reservation for app conatiner',
    },
  },
  Mappings: {
    AWSRegionToAMI: {
      'us-west-2': {
        AMI: 'ami-92e06fea',
      },
    },
  },
  Resources: {
    ECSCluster: {
      Type: 'AWS::ECS::Cluster',
    },
    ECSInstance: {
      Type: 'AWS::EC2::Instance',
      Properties: {
        IamInstanceProfile: { Ref: 'ECSInstanceProfile' },
        ImageId: {
          'Fn::FindInMap': ['AWSRegionToAMI', { Ref: 'AWS::Region' }, 'AMI'],
        },
        InstanceType: { Ref: 'InstanceType' },
        SubnetId: { Ref: 'SubnetId' },
        SecurityGroupIds: [
          { 'Fn::GetAtt': 'ECSSecurityGroup.GroupId' },
          { Ref: 'AppAccessSecurityGroupId' },
        ],
        KeyName: { Ref: 'KeyName' },
        Tags: [
          {
            Key: 'Name',
            Value: { Ref: 'AWS::StackName' },
          },
        ],
        UserData: {
          'Fn::Base64': {
            'Fn::Sub': `#!/bin/bash
yum install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm
yum install -y aws-cfn-bootstrap hibagent
/opt/aws/bin/cfn-init -v --region \${AWS::Region} --stack \${AWS::StackName} --resource ECSInstance
`,
          },
        },
      },
      Metadata: {
        'AWS::CloudFormation::Init': {
          config: {
            packages: {
              yum: {
                awslogs: [],
              },
            },
            commands: {
              '01_add_instance_to_cluster': {
                command: {
                  'Fn::Sub':
                    'echo ECS_CLUSTER=${ECSCluster} >> /etc/ecs/ecs.config',
                },
              },
            },
            files: {
              '/etc/cfn/cfn-hup.conf': {
                mode: '000400',
                owner: 'root',
                group: 'root',
                content: {
                  'Fn::Sub': `[main]
stack=\${AWS::StackId}
region=\${AWS::Region}
`,
                },
              },
              '/etc/cfn/hooks.d/cfn-auto-reloader.conf': {
                content: {
                  'Fn::Sub': `[cfn-auto-reloader-hook]
triggers=post.update
path=Resources.ECSInstance.Metadata.AWS::CloudFormation::Init
action=/opt/aws/bin/cfn-init -v --region \${AWS::Region} --stack \${AWS::StackName} --resource ECSInstance
`,
                },
              },
              '/etc/awslogs/awscli.conf': {
                content: {
                  'Fn::Sub': `[plugins]
cwlogs = cwlogs
[default]
region = \${AWS::Region}
`,
                },
              },
              '/etc/awslogs/awslogs.conf': {
                content: {
                  'Fn::Sub': `[general]
state_file = /var/lib/awslogs/agent-state
[/var/log/dmesg]
file = /var/log/dmesg
log_group_name = \${ECSCluster}-/var/log/dmesg
log_stream_name = \${ECSCluster}
[/var/log/messages]
file = /var/log/messages
log_group_name = \${ECSCluster}-/var/log/messages
log_stream_name = \${ECSCluster}
datetime_format = %b %d %H:%M:%S
[/var/log/docker]
file = /var/log/docker
log_group_name = \${ECSCluster}-/var/log/docker
log_stream_name = \${ECSCluster}
datetime_format = %Y-%m-%dT%H:%M:%S.%f
[/var/log/ecs/ecs-init.log]
file = /var/log/ecs/ecs-init.log.*
log_group_name = \${ECSCluster}-/var/log/ecs/ecs-init.log
log_stream_name = \${ECSCluster}
datetime_format = %Y-%m-%dT%H:%M:%SZ
[/var/log/ecs/ecs-agent.log]
file = /var/log/ecs/ecs-agent.log.*
log_group_name = \${ECSCluster}-/var/log/ecs/ecs-agent.log
log_stream_name = \${ECSCluster}
datetime_format = %Y-%m-%dT%H:%M:%SZ
[/var/log/ecs/audit.log]
file = /var/log/ecs/audit.log.*
log_group_name = \${ECSCluster}-/var/log/ecs/audit.log
log_stream_name = \${ECSCluster}
datetime_format = %Y-%m-%dT%H:%M:%SZ`,
                },
              },
            },
            services: {
              sysvinit: {
                'cfn-hup': {
                  enabled: true,
                  ensureRunning: true,
                  files: [
                    '/etc/cfn/cfn-hup.conf',
                    '/etc/cfn/hooks.d/cfn-auto-reloader.conf',
                  ],
                },
                awslogs: {
                  enabled: true,
                  ensureRunning: true,
                  files: [
                    '/etc/awslogs/awslogs.conf',
                    '/etc/awslogs/awscli.conf',
                  ],
                },
              },
            },
          },
        },
      },
    },
    ECSRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        Path: '/',
        RoleName: { 'Fn::Sub': '${AWS::StackName}-ECSRole-${AWS::Region}' },
        AssumeRolePolicyDocument: `{
  "Statement": [{
    "Action": "sts:AssumeRole",
    "Effect": "Allow",
    "Principal": {
      "Service": "ec2.amazonaws.com"
    }
  }]
}`,
        Policies: [
          {
            PolicyName: 'ecs-service',
            PolicyDocument: `{
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ecs:CreateCluster",
      "ecs:DeregisterContainerInstance",
      "ecs:DiscoverPollEndpoint",
      "ecs:Poll",
      "ecs:RegisterContainerInstance",
      "ecs:StartTelemetrySession",
      "ecs:Submit*",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:GetAuthorizationToken",
      "ssm:DescribeAssociation",
      "ssm:GetDeployablePatchSnapshotForInstance",
      "ssm:GetDocument",
      "ssm:GetManifest",
      "ssm:GetParameters",
      "ssm:ListAssociations",
      "ssm:ListInstanceAssociations",
      "ssm:PutInventory",
      "ssm:PutComplianceItems",
      "ssm:PutConfigurePackageResult",
      "ssm:UpdateAssociationStatus",
      "ssm:UpdateInstanceAssociationStatus",
      "ssm:UpdateInstanceInformation",
      "ec2messages:AcknowledgeMessage",
      "ec2messages:DeleteMessage",
      "ec2messages:FailMessage",
      "ec2messages:GetEndpoint",
      "ec2messages:GetMessages",
      "ec2messages:SendReply",
      "cloudwatch:PutMetricData",
      "ec2:DescribeInstanceStatus",
      "ds:CreateComputer",
      "ds:DescribeDirectories",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents"
    ],
    "Resource": "*"
  }]
}`,
          },
        ],
      },
    },
    ECSInstanceProfile: {
      Type: 'AWS::IAM::InstanceProfile',
      Properties: {
        Path: '/',
        Roles: [{ Ref: 'ECSRole' }],
      },
    },
    ECSSecurityGroup: {
      Type: 'AWS::EC2::SecurityGroup',
      Properties: {
        GroupDescription: 'ECS Security Group',
        VpcId: { Ref: 'VpcId' },
        SecurityGroupIngress: [
          {
            Description: 'Ping',
            IpProtocol: 'icmp',
            FromPort: 8,
            ToPort: -1,
            CidrIp: '0.0.0.0/0',
          },
        ],
      },
    },
    CloudWatchLogsGroup: {
      Type: 'AWS::Logs::LogGroup',
      Properties: {
        LogGroupName: { 'Fn::Sub': 'ECSLogGroup-${AWS::StackName}' },
        RetentionInDays: 7,
      },
    },
    AppTaskDefinition: {
      Type: 'AWS::ECS::TaskDefinition',
      Properties: {
        Family: { Ref: 'AWS::StackName' },
        ContainerDefinitions: [
          {
            Name: 'app',
            Image: { Ref: 'AppDockerImage' },
            MemoryReservation: { Ref: 'AppMemoryReservation' },
            LogConfiguration: {
              LogDriver: 'awslogs',
              Options: {
                'awslogs-group': { Ref: 'CloudWatchLogsGroup' },
                'awslogs-region': { Ref: 'AWS::Region' },
                'awslogs-stream-prefix': { Ref: 'AWS::StackName' },
              },
            },
            // Uncomment to map a port from the host to the container
            // PortMappings: [
            //   {
            //     ContainerPort: 80,
            //     HostPort: 80,
            //   },
            // ],
          },
        ],
      },
    },
    AppService: {
      Type: 'AWS::ECS::Service',
      Properties: {
        ServiceName: 'AppService',
        Cluster: { Ref: 'ECSCluster' },
        DeploymentConfiguration: {
          MaximumPercent: 100,
          MinimumHealthyPercent: 0,
        },
        DesiredCount: 1,
        TaskDefinition: { Ref: 'AppTaskDefinition' },
      },
    },
  },
  Outputs: {
    PublicIPAddress: {
      Value: { 'Fn::GetAtt': 'ECSInstance.PublicIp' },
    },
    PrivateIPAddress: {
      Value: { 'Fn::GetAtt': 'ECSInstance.PrivateIp' },
    },
  },
}

module.exports = { template }
