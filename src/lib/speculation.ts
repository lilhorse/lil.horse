/** Hovered same-origin links prerender; feeds, images and the search index are not pages, so they are left out. */
export const SPECULATION_RULES = JSON.stringify({
  prerender: [
    {
      where: {
        and: [
          { href_matches: '/*' },
          { not: { href_matches: ['/feed.xml', '/og/*', '/_media/*', '/pagefind/*'] } },
        ],
      },
      eagerness: 'moderate',
    },
  ],
});
