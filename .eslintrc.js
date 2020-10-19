module.exports = {
  extends: ['airbnb-base', 'prettier'],
  plugins: ['import', 'prettier'],
  env: {
    node: true,
  },
  parserOptions: {
    sourceType: 'script',
  },
  rules: {
    strict: ['error', 'safe'],
    'prettier/prettier': ['error'],
    'no-console': 0
  },
};
