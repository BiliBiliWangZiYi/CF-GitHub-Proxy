'use strict';

const ASSET_URL = 'https://BiliBiliWangZiYi.github.io/';
const PREFIX = '/';

const Config = { jsdelivr: 0 };
const whiteList = [];

const PREFLIGHT_INIT = {
    status: 204,
    headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
        'access-control-max-age': '1728000',
    },
};

const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i;
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i;
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i;
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i;
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i;
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i;
const exp7 = /^(?:https?:\/\/)?api\.github\.com\/.*$/i;
const exp8 = /^(?:https?:\/\/)?[\w-]+\.github\.io\/.*$/i;

function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*';
    return new Response(body, { status, headers });
}

function newUrl(urlStr, base = undefined) {
    try {
        return new URL(urlStr, base);
    } catch {
        return null;
    }
}

function checkUrl(u) {
    if (typeof u !== 'string') return false;
    for (let i of [exp1, exp2, exp3, exp4, exp5, exp6, exp7, exp8]) {
        if (u.search(i) === 0) return true;
    }
    return false;
}

function cleanRedirectHeaders(headers, method) {
    const newHeaders = new Headers(headers);
    const removeHeaders = ['content-length', 'content-type', 'content-encoding', 'transfer-encoding', 'content-range'];
    for (const h of removeHeaders) newHeaders.delete(h);
    if (method === 'GET' || method === 'HEAD') newHeaders.delete('content-type');
    return newHeaders;
}

async function fetchHandler(req) {
    const urlObj = new URL(req.url);
    let qPath = urlObj.searchParams.get('q');
    if (qPath) {
        const encodedPath = encodeURIComponent(qPath);
        // 302 临时重定向，避免浏览器永久缓存
        return Response.redirect('https://' + urlObj.host + PREFIX + encodedPath, 302);
    }

    // 处理根路径（无论是否有查询参数，只要 pathname 为 / 或 / 的等价形式）
    if (urlObj.pathname === '/' || urlObj.pathname === PREFIX) {
        return fetch(ASSET_URL);
    }

    let rawPath = urlObj.pathname.slice(PREFIX.length) + urlObj.search;
    if (!rawPath) return fetch(ASSET_URL);

    rawPath = rawPath.replace(/^\/+/, '');
    let targetUrl = rawPath;
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

    if (targetUrl.search(exp7) === 0) {
        return httpHandler(req, targetUrl);
    } else if (targetUrl.search(exp4) === 0) {
        if (Config.jsdelivr) {
            const newUrl = targetUrl.replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1').replace(/^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/, 'https://cdn.jsdelivr.net/gh');
            return Response.redirect(newUrl, 302);
        } else {
            return httpHandler(req, targetUrl);
        }
    } else if (targetUrl.search(exp2) === 0) {
        if (Config.jsdelivr) {
            const newUrl = targetUrl.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh');
            return Response.redirect(newUrl, 302);
        } else {
            const rawUrl = targetUrl.replace('/blob/', '/raw/');
            return httpHandler(req, rawUrl);
        }
    } else if (
        targetUrl.search(exp1) === 0 ||
        targetUrl.search(exp5) === 0 ||
        targetUrl.search(exp6) === 0 ||
        targetUrl.search(exp3) === 0 ||
        targetUrl.search(exp8) === 0
    ) {
        return httpHandler(req, targetUrl);
    } else {
        return fetch(ASSET_URL + rawPath);
    }
}

async function httpHandler(req, urlStr) {
    const reqHdrRaw = req.headers;
    if (req.method === 'OPTIONS' && reqHdrRaw.has('access-control-request-headers')) {
        return new Response(null, PREFLIGHT_INIT);
    }

    const reqHdrNew = new Headers(reqHdrRaw);
    let flag = !whiteList.length;
    if (!flag) {
        const urlObj = newUrl(urlStr);
        if (urlObj) {
            const full = urlObj.href;
            for (let i of whiteList) {
                if (full.startsWith(i)) { flag = true; break; }
            }
        }
    }
    if (!flag) return new Response("blocked", { status: 403 });

    if (!/^https?:\/\//i.test(urlStr)) urlStr = 'https://' + urlStr;
    const urlObj = newUrl(urlStr);
    if (!urlObj) return new Response("Invalid URL", { status: 400 });

    const reqInit = {
        method: req.method,
        headers: reqHdrNew,
        redirect: 'manual',
        body: req.body
    };

    try {
        return await proxy(urlObj, reqInit, 0);
    } catch (err) {
        console.error('Proxy error:', err);
        return new Response('Proxy request failed', { status: 502 });
    }
}

async function proxy(urlObj, reqInit, depth = 0) {
    const MAX_REDIRECTS = 20;
    if (depth > MAX_REDIRECTS) return new Response("Too many redirects", { status: 508 });
    if (!urlObj || !urlObj.href) return new Response("Bad redirect URL", { status: 400 });

    let res;
    try {
        res = await fetch(urlObj.href, reqInit);
    } catch (err) {
        console.error('Fetch error:', err);
        return new Response('Network error', { status: 502 });
    }

    const resHdrNew = new Headers(res.headers);
    const status = res.status;

    if (resHdrNew.has('location')) {
        let loc = resHdrNew.get('location');
        if (loc && typeof loc === 'string') {
            if (checkUrl(loc)) {
                resHdrNew.set('location', PREFIX + loc);
            } else {
                res.body?.cancel();
                const nextUrl = newUrl(loc, urlObj.href);
                if (!nextUrl) return new Response("Invalid redirect location", { status: 502 });
                const newMethod = (reqInit.method === 'HEAD') ? 'HEAD' : 'GET';
                const cleanHeaders = cleanRedirectHeaders(reqInit.headers, newMethod);
                const newReqInit = {
                    method: newMethod,
                    headers: cleanHeaders,
                    redirect: 'manual'
                };
                return proxy(nextUrl, newReqInit, depth + 1);
            }
        }
    }

    resHdrNew.set('access-control-expose-headers', '*');
    resHdrNew.set('access-control-allow-origin', '*');
    resHdrNew.delete('content-security-policy');
    resHdrNew.delete('content-security-policy-report-only');
    resHdrNew.delete('clear-site-data');

    return new Response(res.body, { status, headers: resHdrNew });
}

// Cloudflare Workers / Snippets 入口
addEventListener('fetch', event => {
    event.respondWith(fetchHandler(event.request));
});
