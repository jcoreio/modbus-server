#!/usr/bin/env node
// @flow

'use strict'

/* eslint-disable flowtype/require-return-type, flowtype/require-parameter-type */

const glob = require('glob')
const path = require('path')
const { execSync } = require('child_process')
const { flatten, values } = require('lodash')
const touch = require('touch')
const fs = require('fs-extra')
const chalk = require('chalk')
const Promake = require('promake')

const dockerPush = require('./scripts/dockerPush')
const getDockerTags = require('./scripts/getDockerTags')
const getNPMToken = require('./scripts/getNPMToken')

const promake = new Promake()

process.chdir(__dirname)
const pathDelimiter = /^win/.test(process.platform) ? ';' : ':'
const npmBin = execSync(`npm bin`)
  .toString('utf8')
  .trim()
process.env.PATH = process.env.PATH
  ? `${npmBin}${pathDelimiter}${process.env.PATH}`
  : npmBin

const { rule, task, exec, cli } = promake

const spawn = (command, args, options) => {
  if (!Array.isArray(args)) {
    options = args
    args = []
  }
  if (!args) args = []
  if (!options) options = {}
  return promake.spawn(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

function remove(path /* : string */) /* : Promise<void> */ {
  // eslint-disable-next-line no-console
  console.error(
    chalk.gray('$'),
    chalk.gray('rm'),
    chalk.gray('-rf'),
    chalk.gray(path)
  ) // eslint-disable-line no-console
  return fs.remove(path)
}

rule('node_modules', ['package.json', 'yarn.lock'], async () => {
  await exec('yarn --ignore-scripts')
  await touch('node_modules')
})

function env(...names /* : Array<string> */) /* : {[name: string]: ?string} */ {
  return {
    ...process.env,
    //...require('defaultenv')(names.map(name => `env/${name}.js`), {noExport: true}),
    ...require('defaultenv')([], { noExport: true }),
  }
}

const libDir = path.resolve('lib')
const srcFiles = glob.sync('src/**/*.js')
const transpiledFiles = srcFiles.map(file => file.replace(/^src/, libDir))
const transpilePrereqs = [...srcFiles, 'node_modules', '.babelrc.js']

rule(transpiledFiles, transpilePrereqs, async () => {
  await remove(libDir)
  await spawn('babel', ['src', '--out-dir', libDir])
})
// Just transpile from src to lib
task('build', transpiledFiles)

task('clean', async () => {
  await remove(libDir)
}).description('remove build output')

const dockerBuildTask = task('docker:build', transpiledFiles, async () => {
  const dockerTags = await getDockerTags()
  const tagArgs = flatten(values(dockerTags).map(tag => ['-t', tag]))
  const npmToken = await getNPMToken()
  await spawn('docker', [
    'build',
    '--build-arg',
    `NPM_TOKEN=${npmToken}`,
    ...tagArgs,
    '.',
  ])
}).description('generate Docker container')

const runDocker = () => spawn('docker-compose', ['up'], { env: env() })

task('docker:run', dockerBuildTask, runDocker).description(
  'build and run the docker image'
)
task('docker:run:built', runDocker).description(
  'run the already-built docker image'
)

const dockerPushTask = task(
  'docker:push',
  dockerBuildTask,
  dockerPush
).description('build and push docker image')
task('docker:push:built', dockerPush).description(
  'push already-built docker image'
)

task('flow', 'node_modules', () => spawn('flow')).description(
  'check files with flow'
)

task('flow:watch', 'node_modules', () =>
  spawn('flow-watch', [
    '--watch',
    '.flowconfig',
    '--watch',
    'src/',
    '--watch',
    'scripts/',
    '--watch',
    'test/',
    '--watch',
    'run',
    '--watch',
    'run.js',
  ])
).description('run flow in watch mode')

const lintFiles = ['run', 'run.js', 'src', 'scripts', 'test']

task('lint', ['node_modules'], () =>
  spawn('eslint', [...lintFiles, '--cache'])
).description('check files with eslint')
task('lint:fix', 'node_modules', () =>
  spawn('eslint', ['--fix', ...lintFiles, '--cache'])
).description('fix eslint errors automatically')
task('lint:watch', 'node_modules', () =>
  spawn('esw', ['-w', ...lintFiles, '--changed', '--cache'])
).description('run eslint in watch mode')

for (const fix of [false, true]) {
  task(`prettier${fix ? ':fix' : ''}`, ['node_modules'], () =>
    spawn('prettier', [
      fix ? '--write' : '--list-different',
      'run.js',
      'src/**/*.js',
      'test/**/*.js',
    ])
  )
}

function testRecipe(
  options /* : {
  unit?: boolean,
  integration?: boolean,
  coverage?: boolean,
  watch?: boolean,
  debug?: boolean,
} */
) /* : (rule: {args: Array<string>}) => Promise<void> */ {
  const { unit, integration, coverage, watch, debug } = options
  const args = ['-r', '@babel/register']
  if (watch) args.push('./test/clearConsole.js')

  if (unit) args.push('./test/unit/**/*.js')
  if (integration) args.push('./test/integration/**/*.js')
  if (watch) args.push('--watch')
  if (debug) args.push('--inspect-brk')
  let command = 'mocha'
  if (coverage) {
    args.unshift('--reporter=lcov', '--reporter=text', command)
    command = 'nyc'
  }

  return rule =>
    spawn(command, [...args, ...rule.args], {
      env: env('test', 'local'),
      stdio: 'inherit',
    })
}

for (let coverage of [false, true]) {
  const prefix = coverage ? 'coverage' : 'test'
  for (let watch of coverage ? [false] : [false, true]) {
    for (let debug of watch ? [false] : [false, true]) {
      const suffix = watch ? ':watch' : debug ? ':debug' : ''
      task(
        `${prefix}${suffix}`,
        ['node_modules'],
        testRecipe({ unit: true, coverage, watch, debug })
      ).description(
        `run unit tests${coverage ? ' with code coverage' : ''}${
          watch ? ' in watch mode' : ''
        }${debug ? ' in debug mode' : ''}`
      )
      task(
        `${prefix}:all${suffix}`,
        ['node_modules'],
        testRecipe({ unit: true, integration: true, coverage, watch, debug })
      ).description(
        `run all tests${coverage ? ' with code coverage' : ''}${
          watch ? ' in watch mode' : ''
        }${debug ? ' in debug mode' : ''}`
      )
    }
  }
}

task('prep', [
  task('lint:fix'),
  task('prettier:fix'),
  task('flow'),
  task('test'),
]).description('run all checks, automatic fixes, and unit tests')

const deployECS = () => spawn('babel-node', ['scripts/ecsDeploy'])
task('deploy:ecs', dockerPushTask, deployECS).description(
  'build and push docker image and deploy to AWS Elastic Container Service'
)
task('deploy:ecs:built', deployECS).description(
  'deploy already built and pushed docker image to AWS Elastic Container Service'
)

task('open:coverage', () => {
  require('opn')('coverage/lcov-report/index.html')
}).description('open test coverage output')

cli()
