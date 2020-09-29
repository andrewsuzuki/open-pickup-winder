module.exports = (config) => {
  // Fix for react invalid hook call errors (multiple reacts?)
  // See: https://github.com/electron-userland/electron-webpack/issues/361
  config.externals = [...config.externals, "react", "react-dom"];

  // Set up postcss-loader
  // config.module.rules
  //   .find((rule) => rule.test.toString().match(/css/))
  //   .use.push("postcss-loader");

  return config;
};
