import { join } from 'node:path';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

const container = await AstroContainer.create();
const validator = new HtmlValidate(new FileSystemConfigLoader());

export function render(
  component: Parameters<AstroContainer['renderToString']>[0],
  props: Record<string, unknown> = {},
  url = 'https://lil.horse/',
): Promise<string> {
  return container.renderToString(component, { props, request: new Request(url) });
}

export const textOf = (html: string): string => html.replace(/<[^>]+>/g, '');

/** html-validate errors under the repo's config; a fragment is checked inside a minimal page. */
export async function htmlErrors(html: string): Promise<string[]> {
  // Partial rendering drops the doctype of a full page.
  const page = /^<html[\s>]/i.test(html)
    ? `<!doctype html>${html}`
    : `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body><main>${html}</main></body></html>`;
  const report = await validator.validateString(page, join(process.cwd(), 'fragment.html'));
  return report.results.flatMap((result) =>
    result.messages
      .filter((message) => message.severity === 2)
      .map((message) => `${message.ruleId}: ${message.message}`),
  );
}
