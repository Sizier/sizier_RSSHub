import { load } from 'cheerio';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import got from '@/utils/got';

const baseUrl = 'https://github.com';

const validSince = new Set(['daily', 'weekly', 'monthly']);

export const route: Route = {
    path: '/trending/:since/:language?/:spoken_language?',
    categories: ['programming'],
    example: '/github/trending/weekly/any',
    parameters: {
        since: '时间范围：daily、weekly、monthly',
        language: '编程语言，例如 javascript、python、rust；any 表示全部语言',
        spoken_language: '自然语言代码，例如 en、zh',
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Trending',
    maintainers: ['Sizier'],
    handler,
};

async function handler(ctx) {
    const since = ctx.req.param('since');
    const language = ctx.req.param('language') || 'any';
    const spokenLanguage = ctx.req.param('spoken_language');

    if (!validSince.has(since)) {
        throw new InvalidParameterError(
            'Invalid time range. Use daily, weekly, or monthly.'
        );
    }

    const languagePath = language === 'any' ? '' : `/${encodeURIComponent(language)}`;

    const url = `${baseUrl}/trending${languagePath}`;

    const searchParams = new URLSearchParams({
        since,
    });

    if (spokenLanguage) {
        searchParams.set(
            'spoken_language_code',
            spokenLanguage
        );
    }

    const response = await got({
        method: 'get',
        url,
        searchParams,
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    const $ = load(response.data);

    const items = $('article.Box-row')
        .toArray()
        .map((element) => {
            const item = $(element);

            const repoLink = item.find('h2 a').first();

            const href = repoLink.attr('href');

            if (!href) {
                return null;
            }

            const link = `${baseUrl}${href}`;

            const title = repoLink
                .text()
                .replace(/\s+/g, ' ')
                .trim();

            const description = item
                .find('p')
                .first()
                .text()
                .replace(/\s+/g, ' ')
                .trim();

            const languageName = item
                .find('[itemprop="programmingLanguage"]')
                .first()
                .text()
                .trim();

            const stars = item
                .find('a[href$="/stargazers"]')
                .first()
                .text()
                .replace(/\s+/g, ' ')
                .trim();

            const forks = item
                .find('a[href$="/forks"]')
                .first()
                .text()
                .replace(/\s+/g, ' ')
                .trim();

            const starsToday = item
                .find('span.d-inline-block.float-sm-right')
                .first()
                .text()
                .replace(/\s+/g, ' ')
                .trim();

            const repository = href.replace(/^\/|\/$/g, '');

            const details = [
                languageName ? `语言：${languageName}` : '',
                stars ? `Stars：${stars}` : '',
                forks ? `Forks：${forks}` : '',
                starsToday ? `本周期：${starsToday}` : '',
            ]
                .filter(Boolean)
                .join(' · ');

            const htmlDescription = `
                <p>${escapeHtml(description)}</p>
                ${
                    details
                        ? `<p>${escapeHtml(details)}</p>`
                        : ''
                }
            `;

            return {
                title: title || repository,
                description: htmlDescription,
                link,
                guid: `github-trending-${since}-${repository}`,
            };
        })
        .filter(Boolean);

    return {
        title: `GitHub Trending - ${since}${language !== 'any' ? ` - ${language}` : ''}`,
        description: `GitHub Trending ${since}`,
        link: `${url}?${searchParams.toString()}`,
        item: items,
    };
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}