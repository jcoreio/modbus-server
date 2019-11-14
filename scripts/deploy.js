#!/usr/bin/env node

/* eslint-disable  @typescript-eslint/no-var-requires, @typescript-eslint/explicit-function-return-type, no-console */

const { kebabCase } = require('lodash')
const { upsertPublicAndPrivateRecords } = require('mindless-route53')
const {
  deployCloudFormationStack,
  getVPCIdBySubnetId,
  upsertSecurityGroup,
} = require('@jcoreio/cloudformation-tools')
const requireEnv = require('@jcoreio/require-env')

const { template } = require('./cloudFormationTemplate')
const { getDockerTags } = require('./dockerTags')
const { getECRHost } = require('./ecr')

async function deploy(params) {
  const { approve, StackName, HostName, AWSRegion, KeyName, SubnetId } = params

  const requiredParamValues = {
    StackName,
    HostName,
    AWSRegion,
    KeyName,
    SubnetId,
  }
  const missingParams = Object.keys(requiredParamValues).filter(
    key => !requiredParamValues[key]
  )
  const numMissingParams = missingParams.length
  if (numMissingParams) {
    throw Error(
      `missing required parameter${
        numMissingParams > 1 ? 's' : ''
      }: ${missingParams.join(', ')}`
    )
  }

  const InstanceType = params.InstanceType || 't3.micro'
  const AppMemoryReservation = params.AppMemoryReservation || 256
  const AppAccessSecurityGroupName =
    params.AppAccessSecurityGroupName || kebabCase(`${StackName}-access-sg`)

  const AppDockerImage = `${getECRHost()}/${(await getDockerTags()).commitHash}`
  console.log(`using Docker image: ${AppDockerImage}`)

  console.log(`looking up VPC ID for subnet ID ${SubnetId}`)
  const vpcId = await getVPCIdBySubnetId({
    subnetId: SubnetId,
    region: AWSRegion,
  })

  console.log(
    `ensuring ${AppAccessSecurityGroupName} access security group exists`
  )
  const {
    securityGroupId: AppAccessSecurityGroupId,
  } = await upsertSecurityGroup({
    securityGroupName: AppAccessSecurityGroupName,
    securityGroupDescription: `Access to ${StackName}`,
    vpcId,
    region: AWSRegion,
  })

  const Parameters = {
    KeyName,
    SubnetId,
    VpcId: vpcId,
    InstanceType,
    AppAccessSecurityGroupId,
    AppDockerImage,
    AppMemoryReservation,
  }

  console.log('deploying CloudFormation template')
  const {
    Outputs: { PublicIPAddress, PrivateIPAddress },
  } = await deployCloudFormationStack({
    approve,
    readOutputs: true,
    region: AWSRegion,
    StackName,
    TemplateBody: JSON.stringify(template, null, 2),
    Parameters,
    Capabilities: ['CAPABILITY_NAMED_IAM'],
  })

  console.log('upserting DNS records')
  await upsertPublicAndPrivateRecords({
    Name: HostName,
    PrivateTarget: PrivateIPAddress,
    PublicTarget: PublicIPAddress,
    TTL: 60,
  })
  console.log('deploy succeeded')
}

async function deployFromEnv() {
  const {
    APPROVE,
    INSTANCE_TYPE,
    MEMORY_RESERVATION,
    ACCESS_SG_NAME,
  } = process.env
  await deploy({
    approve: !!parseInt(APPROVE),
    StackName: requireEnv('STACK_NAME'),
    HostName: requireEnv('HOST_NAME'),
    AWSRegion: requireEnv('AWS_REGION'),
    KeyName: requireEnv('KEY_NAME'),
    SubnetId: requireEnv('SUBNET_ID'),
    InstanceType: INSTANCE_TYPE,
    AppMemoryReservation: MEMORY_RESERVATION,
    AppAccessSecurityGroupName: ACCESS_SG_NAME,
  })
}

module.exports = { deploy, deployFromEnv }

if (require.main === module) {
  deployFromEnv()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('deploy failed', err)
      process.exit(1)
    })
}
