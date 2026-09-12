import type { MetadataRoute } from 'next';

const SITE_URL = 'https://procurement-platform.example';

/** Only the routes robots.ts allows crawling - every other page requires a session and has
 *  nothing to offer a search index. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/login`, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${SITE_URL}/register`, changeFrequency: 'yearly', priority: 0.8 },
  ];
}
