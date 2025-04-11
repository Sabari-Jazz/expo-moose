module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Add support for static class blocks
      "@babel/plugin-transform-class-static-block",
      // Keep any existing plugins
      [
        "module-resolver",
        {
          alias: {
            "@": "./",
          },
        },
      ],
    ],
  };
};
