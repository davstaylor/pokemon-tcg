import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://davstaylor.github.io',
  base: '/pokemon-tcg',
  integrations: [preact(), sitemap()],
  output: 'static',
});
