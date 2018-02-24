import babel from 'rollup-plugin-babel';
import copy from 'rollup-plugin-copy';
import gas from 'rollup-plugin-gas';
import nodeResolve from 'rollup-plugin-node-resolve';

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/index.js',
    format: 'es',
  },
  plugins: [
    nodeResolve({ jsnext: true }),
    babel({
      exclude: 'node_modules/**',
    }),
    gas(),
    copy({ 'src/appsscript.json': 'dist/appsscript.json' }),
  ],
};
