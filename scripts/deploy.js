#!/usr/bin/env node

const { upsertPublicAndPrivateRecords } = require('mindless-route53')
const { deployCloudFormationStack } = require('@jcoreio/cloudformation-tools')

const { getTemplate } = require('./cloudFormationTemplate')
const { getDockerTags } = require('./dockerTags')

/* eslint-disable no-console */

module.exports = { deploy }

async function deploy(params) {
  const {
    approve,
    StackName,
    HostName,
    AWSRegion,
    KeyName,
    SubnetId,
    VpcId,
    AppAccessSecurityGroupId,
  } = params
  const InstanceType = params.InstanceType || 't3.micro'
  const AppMemoryReservation = params.AppMemoryReservation || 256

  const requiredParamValues = {
    StackName,
    HostName,
    AWSRegion,
    KeyName,
    SubnetId,
    VpcId,
    AppAccessSecurityGroupId,
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

  const { commitHash: AppDockerImage } = await getDockerTags()
  console.log(`using Docker tag: ${AppDockerImage}`)

  const Parameters = {
    KeyName,
    SubnetId,
    VpcId,
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
    TemplateBody: JSON.stringify(getTemplate(), null, 2),
    Parameters,
    Capabilities: ['CAPABILITY_IAM'],
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
