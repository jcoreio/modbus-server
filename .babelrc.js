module.exports = function(api) {
  return {
    plugins: api.env('coverage') ? ['babel-plugin-istanbul'] : [],
    presets: [['@babel/env', { targets: { node: '8' } }], '@babel/typescript'],
  }
}
