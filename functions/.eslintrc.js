module.exports = {
  env: {
    es6: true,
    node: true,
  },
  parserOptions: {
    "ecmaVersion": 2022,
  },
  extends: [
    "eslint:recommended",
    "google",
  ],
  rules: {
    "no-restricted-globals": ["error", "name", "length"],
    "prefer-arrow-callback": "error",
    "quotes": ["error", "double", {"allowTemplateLiterals": true}],
    "max-len": ["warn", {"code": 120, "ignoreComments": true, "ignoreStrings": true, "ignoreTemplateLiterals": true}],
    "require-jsdoc": "off",
    "object-curly-spacing": ["error", "never"],
    "new-cap": ["error", {"capIsNewExceptions": ["Router"]}],
  },
  overrides: [
    {
      files: ["**/*.spec.*"],
      env: {
        mocha: true,
      },
      rules: {},
    },
  ],
  globals: {},
};
