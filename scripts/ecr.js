const requireEnv = require('@jcoreio/require-env')
const { exec } = require('@jcoreio/script-tools')

const getECRHost = ({ AWSAccountId, AWSRegion }) =>
  `${AWSAccountId}.dkr.ecr.${AWSRegion}.amazonaws.com`

async function doECRLogin({ otherAWSAccount } = {}) {
  const AWSRegion = requireEnv('AWS_REGION')
  await exec(
    `$(aws ecr get-login --region "${AWSRegion}" ${
      otherAWSAccount ? `--registry-ids ${otherAWSAccount} ` : ''
    }--no-include-email)`
  )
}

module.exports = {
  getECRHost,
  doECRLogin,
}
