import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

export default defineConfig({
  site: 'https://davstaylor.github.io',
  base: '/pokemon-tcg',
  integrations: [preact()],
  output: 'static',
});
