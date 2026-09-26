/**
 * Shared Widget Studio typography catalogue.
 *
 * The Studio and standalone embed use this one whitelist so a chosen font is
 * rendered consistently without loading every Google Font on every page.
 */
(function (global) {
  'use strict';
  const fonts = [
    ['Inter (Clean UI)', "'Inter', sans-serif", 'Inter'],
    ['System Sans', 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif', ''],
    ['Arial', 'Arial, Helvetica, sans-serif', ''],
    ['Roboto', "'Roboto', sans-serif", 'Roboto'],
    ['Open Sans', "'Open Sans', sans-serif", 'Open Sans'],
    ['Lato', "'Lato', sans-serif", 'Lato'],
    ['Montserrat', "'Montserrat', sans-serif", 'Montserrat'],
    ['Poppins', "'Poppins', sans-serif", 'Poppins'],
    ['Nunito', "'Nunito', sans-serif", 'Nunito'],
    ['Source Sans 3', "'Source Sans 3', sans-serif", 'Source Sans 3'],
    ['Work Sans', "'Work Sans', sans-serif", 'Work Sans'],
    ['DM Sans', "'DM Sans', sans-serif", 'DM Sans'],
    ['Manrope', "'Manrope', sans-serif", 'Manrope'],
    ['Outfit', "'Outfit', sans-serif", 'Outfit'],
    ['Plus Jakarta Sans', "'Plus Jakarta Sans', sans-serif", 'Plus Jakarta Sans'],
    ['Space Grotesk', "'Space Grotesk', sans-serif", 'Space Grotesk'],
    ['Raleway', "'Raleway', sans-serif", 'Raleway'],
    ['Ubuntu', "'Ubuntu', sans-serif", 'Ubuntu'],
    ['Fira Sans', "'Fira Sans', sans-serif", 'Fira Sans'],
    ['Archivo', "'Archivo', sans-serif", 'Archivo'],
    ['Merriweather (Editorial)', "'Merriweather', serif", 'Merriweather'],
    ['Lora (Editorial)', "'Lora', serif", 'Lora'],
    ['Playfair Display (Editorial)', "'Playfair Display', serif", 'Playfair Display'],
    ['Libre Baskerville', "'Libre Baskerville', serif", 'Libre Baskerville'],
    ['PT Serif', "'PT Serif', serif", 'PT Serif'],
    ['Source Serif 4', "'Source Serif 4', serif", 'Source Serif 4'],
    ['Roboto Slab', "'Roboto Slab', serif", 'Roboto Slab'],
    ['Bitter', "'Bitter', serif", 'Bitter'],
    ['Georgia', 'Georgia, Cambria, serif', ''],
    ['Oswald (Display)', "'Oswald', sans-serif", 'Oswald'],
    ['Bebas Neue (Display)', "'Bebas Neue', sans-serif", 'Bebas Neue'],
    ['JetBrains Mono (Tech)', "'JetBrains Mono', monospace", 'JetBrains Mono'],
    ['IBM Plex Mono', "'IBM Plex Mono', monospace", 'IBM Plex Mono'],
    ['Fira Code', "'Fira Code', monospace", 'Fira Code'],
    ['Inconsolata', "'Inconsolata', monospace", 'Inconsolata'],
    ['Courier New', "'Courier New', monospace", '']
  ].map(([label, value, googleFamily]) => ({ label, value, googleFamily }));

  function find(value) {
    return fonts.find((font) => font.value === value) || fonts[0];
  }

  function load(value) {
    const font = find(value);
    if (!font.googleFamily || document.querySelector(`link[data-feedometer-font="${font.googleFamily}"]`)) return font;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.feedometerFont = font.googleFamily;
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.googleFamily).replace(/%20/g, '+')}:wght@400;500;600;700;800&display=swap`;
    document.head.appendChild(link);
    return font;
  }

  global.FeedOmeterWidgetFonts = { all: fonts, find, load };
})(window);
