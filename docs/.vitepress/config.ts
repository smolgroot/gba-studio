import { defineConfig } from 'vitepress'

// Served from https://<owner>.github.io/<repository>/: the docs workflow sets DOCS_BASE
// from the repository's name. Use DOCS_BASE=/ for a custom domain or a preview at the root.
export default defineConfig({
  title: 'Pecten-Studio',
  description: 'A desktop and browser studio for making Game Boy Advance Metroidvanias from assets you create yourself.',
  base: process.env.DOCS_BASE ?? '/gba-studio/',
  cleanUrls: true,
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: 'data:,' }]],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/project-format' },
      { text: 'Download', link: 'https://github.com/smolgroot/gba-studio/releases/latest' },
      { text: 'GitHub', link: 'https://github.com/smolgroot/gba-studio' },
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Desktop app', link: '/guide/desktop' },
          { text: 'The interface', link: '/guide/interface' },
        ],
      },
      {
        text: 'Making content',
        items: [
          { text: 'World map', link: '/guide/world-map' },
          { text: 'Rooms and the map editor', link: '/guide/rooms' },
          { text: 'Tilesets', link: '/guide/tilesets' },
          { text: 'Sprites and animations', link: '/guide/sprites' },
          { text: 'Pixel editor', link: '/guide/pixel-editor' },
          { text: 'Audio', link: '/guide/audio' },
          { text: 'Project settings', link: '/guide/project-settings' },
        ],
      },
      {
        text: 'Building and playing',
        items: [
          { text: 'Build and Play', link: '/guide/build-and-play' },
          { text: 'Making a game with it', link: '/guide/making-a-game' },
        ],
      },
      {
        text: 'Working with agents',
        items: [{ text: 'Command line and MCP', link: '/guide/agents' }],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Project format', link: '/reference/project-format' },
          { text: 'Keyboard shortcuts', link: '/reference/shortcuts' },
          { text: 'Known limits', link: '/reference/limits' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/smolgroot/gba-studio' }],
    search: { provider: 'local' },
    outline: [2, 3],
    footer: { message: 'Screenshots show the Diamond Hands project open in the studio.' },
  },
})
