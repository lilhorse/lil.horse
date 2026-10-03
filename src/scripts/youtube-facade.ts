const ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`;
}

/** Swaps each YouTube link for the player on a plain left click; modified clicks still open YouTube. */
export function enhanceYouTube(root: ParentNode): void {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-youtube]')) {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      const frame = document.createElement('iframe');
      frame.className = 'youtube-player';
      frame.src = youtubeEmbedUrl(link.dataset.youtube ?? '');
      frame.title = link.dataset.title ?? 'YouTube video';
      frame.allow = ALLOW;
      frame.allowFullscreen = true;
      link.replaceWith(frame);
      frame.focus();
    });
  }
}
