// Shared navigation contract: { links: [{ title: string, href: string }] }.
// Read the current menu on every page visit; old menu data is not reused.
(async () => {
  try {
    const response = await fetch('/docs/navigation.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Navigation unavailable');
    const menu = await response.json();
    if (!menu || !Array.isArray(menu.links) || !menu.links.every(link =>
      link && typeof link.title === 'string' && typeof link.href === 'string' &&
      Object.keys(link).length === 2 && (/^\/docs\//.test(link.href) || /^https?:\/\//.test(link.href)))) {
      throw new Error('Invalid navigation contract');
    }
    const navigation = document.querySelector('.nav');
    if (!navigation) throw new Error('Navigation element missing');
    const fragment = document.createDocumentFragment();
    for (const item of menu.links) {
      const link = document.createElement('a');
      link.href = item.href;
      link.textContent = item.title;
      fragment.append(link, document.createTextNode(' '));
    }
    navigation.replaceChildren(fragment);
  } catch {
    // Keep the static menu if the network is unavailable.
    console.warn('Shared documentation navigation could not be loaded.');
  }
})();
