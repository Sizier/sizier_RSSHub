import { load } from 'cheerio';

import type { Route } from '@/types';
import { getSubPath } from '@/utils/common-utils';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

import { ProcessItem, rootUrl } from './utils';

const shortcuts = {
    '/information': '/information/web_news',
    '/information/latest': '/information/web_news',
    '/information/recommend': '/information/web_recommend',
    '/information/life': '/information/happy_life',
    '/information/estate': '/information/real_estate',
    '/information/workplace': '/information/web_zhichang',
};

export const route: Route = {
    path: '/:category/:subCategory?/:keyword?',
    categories: ['new-media'],
    example: '/36kr/newsflashes',
    parameters: {
        category: '分类，必填项',
        subCategory: '子分类，选填项，目的是为了兼容老逻辑',
        keyword: '关键词，选填项，仅搜索文章/快讯时有效',
    },
    name: '资讯, 快讯, 用户文章, 主题文章, 专题文章, 搜索文章, 搜索快讯, 热榜',
    maintainers: ['nczitzk', 'fashioncj', 'Sizier'],
    description: `| 最新资讯频道 | 快讯 | 推荐资讯 | 生活 | 房产 | 职场 | 搜索文章 | 搜索快讯 | 热榜 |
| ------------ | -------- | --------- | ---- | ------ | --------- | ----------------------- | ----------------------- | ------ |
| news | newsflashes | recommend | life | estate | workplace | search/articles/ 关键词 | search/articles/ 关键词 | hot-list |`,
    handler,
};

/**
 * 36氪热榜
 *
 * /36kr/hot-list
 *
 * 不再抓取 36kr /hot-list HTML，
 * 避免旧版 `"itemList"` 正则导致 null[1]。
 */
async function getHotList(ctx) {
    const limitValue = ctx.req.query('limit');

    let limit = 30;

    if (limitValue) {
        const parsed = Number.parseInt(limitValue, 10);

        if (!Number.isNaN(parsed) && parsed > 0) {
            limit = Math.min(parsed, 100);
        }
    }

    const apiUrl = 'https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot';

    const response = await got({
        method: 'post',
        url: apiUrl,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Referer: 'https://36kr.com/',
            Origin: 'https://36kr.com',
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        json: {
            partner_id: 'web',
            param: {
                siteId: 1,
                platformId: 2,
            },
            timestamp: Date.now(),
        },
    });

    const data = response.data?.data;

    if (!data) {
        throw new Error('36氪热榜 API 返回数据为空');
    }

    /*
     * 不同版本的 36 氪 API 返回字段可能略有区别。
     * 优先寻找常见的热榜数组。
     */
    const list =
        data.hotRankList ??
        data.itemList ??
        data.list ??
        [];

    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(
            `36氪热榜 API 没有返回文章列表。返回字段：${Object.keys(data).join(', ')}`
        );
    }

    const items = list
        .slice(0, limit)
        .map((item, index) => {
            const material = item.templateMaterial ?? item;

            const itemId =
                item.itemId ??
                material.itemId;

            const title =
                material.widgetTitle ??
                material.title ??
                `36氪热门文章 ${index + 1}`;

            const description =
                material.widgetContent ??
                material.description ??
                material.summary ??
                '';

            const author =
                material.author ??
                material.authorName ??
                '36氪';

            const publishTime =
                item.publishTime ??
                material.publishTime;

            const link = itemId
                ? `${rootUrl}/p/${itemId}`
                : rootUrl;

            return {
                title: String(title).replaceAll(/<\/?em>/g, ''),
                author,
                pubDate: publishTime
                    ? parseDate(publishTime)
                    : new Date(),
                link,
                description,
            };
        });

    return {
        title: '36氪 - 热榜',
        link: 'https://36kr.com/hot-list',
        description: '36氪热门文章排行榜',
        item: items,
    };
}

async function handler(ctx) {
    const path = getSubPath(ctx)
        .replace(/^\/news(?!flashes)/, '/information')
        .replace(/\/search\/article/, '/search/articles');

    /*
     * 重点：
     *
     * /36kr/hot-list
     * 不再请求：
     *
     * https://www.36kr.com/hot-list
     *
     * 因为旧代码依赖：
     *
     * response.data.match(/"itemList":(\[.*?\])/)[1]
     *
     * 当前页面结构变化后 match() 会返回 null，
     * 最终产生：
     *
     * TypeError: Cannot read properties of null (reading '1')
     */
    if (path === '/hot-list') {
        return getHotList(ctx);
    }

    const currentUrl = `${rootUrl}${
        Object.hasOwn(shortcuts, path) ? shortcuts[path] : path
    }`;

    const response = await got({
        method: 'get',
        url: currentUrl,
    });

    const $ = load(response.data);

    /*
     * 原来的代码直接：
     *
     * response.data.match(...)[1]
     *
     * 这里增加安全检查。
     */
    const match = response.data.match(/"itemList":(\[.*?\])/);

    if (!match) {
        throw new Error(
            `36氪页面中没有找到 itemList 数据：${currentUrl}`
        );
    }

    let data;

    try {
        data = JSON.parse(match[1]);
    } catch {
        throw new Error(
            `36氪 itemList JSON 解析失败：${currentUrl}`
        );
    }

    let items = data
        .slice(
            0,
            ctx.req.query('limit')
                ? Number.parseInt(ctx.req.query('limit'))
                : 30
        )
        .filter((item) => item.itemType !== 0)
        .map((item) => {
            item = item.templateMaterial ?? item;

            return {
                title: (item.widgetTitle ?? '')
                    .replaceAll(/<\/?em>/g, ''),
                author: item.author,
                pubDate: parseDate(item.publishTime),
                link: `${rootUrl}/${
                    path === '/newsflashes'
                        ? 'newsflashes'
                        : 'p'
                }/${item.itemId}`,
                description:
                    item.widgetContent ??
                    item.content,
            };
        });

    if (!/^\/(?:search|newsflashes)/.test(path)) {
        items = await Promise.all(
            items.map((item) => ProcessItem(item))
        );
    }

    return {
        title: `36氪 - ${$('title').text().split('_', 1)[0]}`,
        link: currentUrl,
        item: items,
    };
}