module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Tamagui's compiler: flattens styled() components to plain views at build
    // time, which is the whole reason PRD-Mobile §5 picked Tamagui over a
    // runtime CSS-in-JS library.
    plugins: [
      [
        "@tamagui/babel-plugin",
        { components: ["tamagui"], config: "./tamagui.config.ts" },
      ],
    ],
  };
};
