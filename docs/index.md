---
layout: home
hero:
  name: Pecten-Studio
  text: Make Game Boy Advance Metroidvanias on your desktop or in your browser
  tagline: Draw pixel art, paint rooms on a grid of GBA screens, arrange a world, build the ROM and play it, all in one studio.
  image:
    src: /screenshots/room-editor.png
    alt: The map editor showing a room of Diamond Hands
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Desktop app
      link: /guide/desktop
    - theme: alt
      text: The interface
      link: /guide/interface
features:
  - title: Desktop app
    details: Open any game folder and keep several projects open in tabs, each with its own undo history, build and emulator.
  - title: Plain files
    details: A project is a folder of JSON files and your own PNG, MIDI and tracker files. They diff well in git, and the studio picks up edits made elsewhere.
  - title: Real hardware limits
    details: Colours are snapped to the GBA's 15-bit palette, sprites use the twelve real sizes, and problems are listed before you build.
  - title: Build and play
    details: Build your Rust and agb game from the studio and run the ROM right in the studio, with sound and touch buttons.
  - title: Agent friendly
    details: The same project code is a command line and an MCP server, so Claude Code or any MCP client can edit a game without overwriting your art.
---
