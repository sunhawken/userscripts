// ==UserScript==
// @name         AutoPager + Rule34 Only
// @name:zh-CN   自动无缝翻页（仅 Rule34.xxx）
// @version      6.6.75
// @author       X.I.U (trimmed by user)
// @description  Seamlessly append rule34.xxx's next page content to the bottom of the page (infinite scroll). Trimmed from XIU2/UserScript's AutoPager to support only rule34.xxx.
// @match        https://rule34.xxx/*
// @match        https://www.rule34.xxx/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_info
// @grant        GM.info
// @grant        window.onurlchange
// @grant        unsafeWindow
// @sandbox      JavaScript
// @license      GPL-3.0 License
// @run-at       document-end
// @namespace    https://github.com/XIU2/UserScript
// ==/UserScript==
//
// NOTE: Trimmed from XIU2/UserScript's AutoPager (https://github.com/XIU2/UserScript)
// to support ONLY rule34.xxx. Removed: all other built-in site rules (forums, WordPress,
// Typecho, biquge novel sites, video sites, Mangabz/dm5/Xmanhua manga sites, NexusMods,
// Bing), the external rules.json auto-update mechanism (and its @connect mirror list,
// since it would silently re-merge the other sites' rules back in), and @downloadURL /
// @updateURL (so this customized copy won't be auto-overwritten by the original). The
// @icon base64 data URI from the original script was also removed.

(function() {
    'use strict';

    var menuAll = [
        ['menu_disable', '✅ 已启用 (点击对当前网站禁用)', '❌ 已禁用 (点击对当前网站启用)', []],
        ['menu_thread', '帖子内自动翻页 (社区类网站)', '帖子内自动翻页 (社区类网站)', true],
        ['menu_page_number', '显示当前页码及点击暂停翻页', '显示当前页码及点击暂停翻页', true],
        ['menu_pause_page', '左键双击网页空白处暂停翻页', '左键双击网页空白处暂停翻页', false],
        ['menu_history', '添加历史记录+修改地址/标题', '添加历史记录+修改地址/标题', true],
        ['menu_customRules', '自定义翻页规则', '自定义翻页规则', {}]
    ], menuId = [], webType = 0, curSite = {SiteTypeID: 0}, DBSite, DBSite2, DBSiteNow, pausePage = true, pageNum = {now: 1, _now: 1}, urlC = false, nowLocation = '', lp = location.pathname, scriptHandler;
    window.autoPage = {lp: ()=>location.pathname, indexOF: indexOF, isMobile: isMobile, isUrlC: isUrlC, isPager: isPager, isTitle: isTitle, blank: forceTarget, getAll: getAll, getOne: getOne, getAllXpath: getAllXpath, getXpath: getXpath, getAllCSS: getAllCSS, getCSS: getCSS, getNextE: getNextE, getNextEP: getNextEP, getNextSP: getNextSP, getNextEPN: getNextEPN, getNextUPN: getNextUPN, getNextUP: getNextUP, getNextF: getNextF, getSearch: getSearch, getCookie: getCookie, insStyle: insStyle, insScript: insScript, cleanuEvent: cleanuEvent, pageNumIncrement: pageNumIncrement}
    if (typeof GM_info != 'undefined') {scriptHandler = GM_info.scriptHandler;} else if (typeof GM != 'undefined' && typeof GM.info != 'undefined') {scriptHandler = GM.info.scriptHandler;} else {scriptHandler = '';}
    for (let i=0;i<menuAll.length;i++){ // 如果读取到的值为 null 就写入默认值
        if (GM_getValue(menuAll[i][0]) == null){GM_setValue(menuAll[i][0], menuAll[i][3])};
    }
    // 兼容不支持 GM_openInTab 的油猴脚本管理器
    if (typeof GM_openInTab !== 'function') {GM_openInTab = openInTab}
    // 如果浏览器不支持 structuredClone（Chromium 98 才完全支持），则使用 JSON 方法代替
    if (typeof window.structuredClone !== 'function') {window.structuredClone = function(value) {return JSON.parse(JSON.stringify(value));}}

    registerMenuCommand();
    if (menuId.length < 4) {return}
    // 注册脚本菜单
    function registerMenuCommand() {
        if (menuId.length != []){
            for (let i=0;i<menuId.length;i++){
                GM_unregisterMenuCommand(menuId[i]);
            }
        }
        for (let i=0;i<menuAll.length;i++) { // 循环注册脚本菜单
            menuAll[i][3] = GM_getValue(menuAll[i][0]);

            if (menuAll[i][0] === 'menu_disable') { // 启用/禁用

                if (menu_disable('check')) { // 当前网站在禁用列表中
                    menuId[i] = GM_registerMenuCommand(`${menuAll[i][2]}`, function(){menu_disable('del')});
                    return
                } else { // 不在禁用列表中
                    webType = doesItSupport(); // 判断网站类型（即是否支持），顺便直接赋值
                    if (webType === 0) {
                        menuId[0] = GM_registerMenuCommand('❌ 当前网页暂不支持 [点击申请] (或无需翻页)', function(){GM_openInTab('https://github.com/XIU2/UserScript#xiu2userscript', {active: true,insert: true,setParent: true});GM_openInTab('https://greasyfork.org/zh-CN/scripts/419215/feedback', {active: true,insert: true,setParent: true});});
                        menuId[2] = GM_registerMenuCommand('#️⃣ 自定义翻页规则', function(){customRules()});
                        //console.info('[自动无缝翻页] - 暂不支持当前网页 [ ' + location.href + ' ]，申请支持: https://github.com/XIU2/UserScript / https://greasyfork.org/zh-CN/scripts/419215/feedback');
                        return
                    } else if (webType === -1) {
                        return
                    }
                    menuId[i] = GM_registerMenuCommand(`${menuAll[i][1]}`, function(){menu_disable('add')});
                }


            } else if (menuAll[i][0] === 'menu_customRules') {
                menuId[i] = GM_registerMenuCommand(`#️⃣ ${menuAll[i][1]}`, function(){customRules()});

            } else {
                menuId[i] = GM_registerMenuCommand(`${menuAll[i][3]?'✅':'❌'} ${menuAll[i][1]}`, function(){menu_switch(menuAll[i][3], menuAll[i][0], menuAll[i][2])});
            }
        }
        menuId[menuId.length] = GM_registerMenuCommand('💬 反馈失效 / 申请支持', function () {GM_openInTab('https://github.com/XIU2/UserScript#xiu2userscript', {active: true,insert: true,setParent: true});GM_openInTab('https://greasyfork.org/zh-CN/scripts/419215/feedback', {active: true,insert: true,setParent: true});});
    }


    // --------------------------------------------------------


    // 判断是支持
    function doesItSupport() {
        setDBSite(); // 配置 DBSite 变量对象

        // 遍历判断是否是某个已支持的网站，顺便直接赋值
        let support = false;
        end:
        for (let now in DBSite) { // 遍历 对象
            if (DBSite[now].ignore) continue; // 如果是特殊的内置规则（如通用规则）则跳过直接继续下一个循环

            // 供其他函数在 域名/URL 判断阶段使用
            if (typeof DBSite[now].url == 'function'){
                DBSiteNow = DBSite[now] // 如果是脚本内置规则就没必要深度克隆了（用不上 rule 对象变量，毕竟是可以直接操作自身的）
            } else {
                DBSiteNow = structuredClone(DBSite[now]) //深度克隆是为了在后续 url 规则中通过操作 rule 对象变量来修改当前网页规则时，不会间接影响到 DBSite[now] 本身
            }

            // 如果是 数组
            if (Array.isArray(DBSite[now].host)) {

                for (let i of DBSite[now].host) { // 遍历 数组

                    // 针对自定义翻页规则中的正则
                    if (typeof i === 'string' && i.slice(0,1) === '/') i = new RegExp(i.slice(1,i.length-1))
                    if ((i instanceof RegExp && i.test(location.hostname)) || (typeof i === 'string' && i === location.hostname)) {

                        if (self != top) {if (!DBSite[now].iframe) continue end;} // 如果当前位于 iframe 框架下，就需要判断是否需要继续执行
                        if (DBSite[now].url) {
                            if (typeof DBSite[now].url == 'function') {
                                DBSite[now].url();
                            } else { // 自定义翻页规则时，因为同域名不同页面 url 分开写，所以如果没找到就需要跳出当前数组循环，继续规则循环
                                try {
                                    if (DBSite[now].url.slice(0,1) === '/') { // 如果是正则，则对 URL 路径进行匹配
                                        if (new RegExp(DBSite[now].url.slice(1,DBSite[now].url.length-1), 'i').test(location.pathname + location.search) === true) {curSite = DBSite[now];} else {if (urlC === true) {support = true;}; break;}
                                    } else { // 如果是函数，那就执行代码（url 规则中可通过操作 rule 这个对象变量来修改当前网页实际应用的规则）
                                        if (new Function('fun','rule', DBSite[now].url)(window.autoPage,DBSiteNow)) {curSite = DBSiteNow;} else {if (urlC === true) {support = true;}; break;}
                                    }
                                } catch (e) {
                                    console.error('[自动无缝翻页] - 当前网页规则 "url" 匹配出错，请检查：\n', DBSite[now].url + '\n\n', e);
                                }
                            }
                        } else {
                            curSite = DBSite[now];
                        }
                        support = true; break end; // 如果找到了就退出所有循环
                    }
                }

                // 如果是 正则/字符串
            } else {
                // 针对自定义翻页规则中的正则
                if (typeof DBSite[now].host === 'string' && DBSite[now].host.slice(0,1) === '/') DBSite[now].host = new RegExp(DBSite[now].host.slice(1,DBSite[now].host.length-1))
                if ((DBSite[now].host === undefined) || (DBSite[now].host instanceof RegExp && DBSite[now].host.test(location.hostname)) || (typeof DBSite[now].host === 'string' && DBSite[now].host === location.hostname)) {
                    // 如果没有指定 host 规则，那么默认匹配所有域名（会对所有域名匹配 url 规则判断），可以当成一个简单的外置（自定义）通用规则方案

                    if (self != top) {if (!DBSite[now].iframe) continue;} // 如果当前位于 iframe 框架下，就需要判断是否需要继续执行
                    if (DBSite[now].url) {
                        if (typeof DBSite[now].url == 'function') {
                            DBSite[now].url();
                        } else { // 自定义翻页规则时，因为同域名不同页面 url 分开写，所以如果没找到就需要继续规则循环
                            try {
                                if (DBSite[now].url.slice(0,1) === '/') { // 如果是正则，则对 URL 路径进行匹配
                                    if (new RegExp(DBSite[now].url.slice(1,DBSite[now].url.length-1), 'i').test(location.pathname + location.search) === true) {curSite = DBSite[now];} else {if (urlC === true) {support = true;}; continue;}
                                } else { // 如果是函数，那就执行代码（url 规则中可通过操作 rule 这个对象变量来修改当前网页实际应用的规则）
                                    if (new Function('fun','rule', DBSite[now].url)(window.autoPage,DBSiteNow)) {curSite = DBSiteNow;} else {if (urlC === true) {support = true;}; continue;}

                                }
                            } catch (e) {
                                console.error('[自动无缝翻页] - 当前网页规则 "url" 匹配出错，请检查：\n', DBSite[now].url + '\n\n', e);
                            }
                        }
                    } else {
                        curSite = DBSite[now];
                    }
                    support = true; break; // 如果找到了就退出循环
                }
            }
        }

        DBSiteNow = undefined // 仅限判断阶段使用，判断完成就需要置空

        if (support) {
            console.info('[自动无缝翻页] - 独立规则 网站'); return 1;
        }
        return 0;
    }
    // 判断网站类型
    function webTypeIf() {}
    // 内置翻页规则
    function setDBSite() {
        /*
    inherits:    继承标识，仅用于自定义规则，用于增删改某个外置规则的部分规则时，可使用该标识来省略不需要修改的规则，只写有变化的规则

    url:         匹配到该域名后要执行的函数/正则（一般用于根据 URL 分配相应翻页规则，url 规则中可通过操作 rule 这个对象变量来修改当前网页实际应用的规则）
    urlC:        对于使用 pjax 技术的网站，需要监听 URL 变化来重新判断翻页规则（需要放在 url: 中，自定义规则的话需要使用 fun.isUrlC()）

    noReferer:   获取下一页内容时，不携带 Referer（部分网站携带与不携带可能不一样）
    hiddenPN:    不显示脚本左下角的页码
    history:     添加历史记录 并 修改当前 URL（默认开启，对于不支持的网站要设置为 false）
    thread:      对于社区类网站，要在 帖子内 的规则中加入这个，用于脚本的 [帖子内自动翻页] 功能（即用户可以选择开启/关闭所有社区类网站帖子内的自动翻页）
    style:       要插入网页的 CSS Style 样式，当只需要单纯屏蔽部分网页元素时，可以只写 CSS 选择器省略掉 {display: none !important;}
    retry:       允许获取失败后重试
    blank:       强制新标签页打开链接
       1 = 网页 <head> 添加 <base target="_blank"> 来让所有链接默认新标签页打开（对已单独指定 target 或已监听点击事件的元素无效）
       2 = 对 <body> 委托点击事件
       3 = 对 pageE 的父元素 委托点击事件（也会阻止冒泡，但因为距离 <a> 标签较远，因此只有在委托点击事件的元素是 pageE 的父元素的父元素时，才有意义）
       4 = 对 pageE 的子元素 <a> 标签 添加 target="_blank"
       5 = 对 pageE 的子元素 <a> 标签 清理事件后 再添加 target="_blank"
       6 = 对 pageE 的子元素 <a> 标签 清理事件后 再添加 target="_blank" 并阻止冒泡（避免父元素事件委托捕获该元素的点击事件）

pager: {
    type:     翻页模式
       1 = 由脚本实现自动无缝翻页，可省略（适用于：静态加载内容网站，常规模式）

       2 = 只需要点击下一页按钮（适用于：网站自带了 自动无缝翻页 功能）
           nextText:    按钮文本，当按钮文本 = 该文本时，才会点击按钮加载下一页（避免一瞬间加载太多次下一页，下同）
           nextTextOf:  按钮文本的一部分，当按钮文本包含该文本时，才会点击按钮加载下一页
           nextHTML:    按钮内元素，当按钮内元素 = 该元素内容时，才会点击按钮加载下一页
           interval:    点击间隔时间，对于没有按钮文字变化的按钮，可以手动指定间隔时间（省略后默认 500ms，当指定上面三个时，会忽略 interval）
           isHidden:    只有下一页按钮可见时（没有被隐藏），才会点击

       3 = 依靠 [基准元素] 与 [浏览器可视区域底部] 之间的距离缩小来触发翻页（适用于：主体元素下方内容太多 且 高度不固定时）
           scrollE:     作为基准线的元素（一般为底部页码元素），省略后默认等同 replaceE（如果这个也未指定则改用 nextL）
           scrollD:     当 [基准元素] 与 [可视区域底部] 之间的距离 等于或小于该值时，将触发翻页，省略后默认 2000

       4 = 动态加载类网站（适用于：简单的动态加载内容网站）
           insertE:     用来插入元素的函数

       5 = 插入 iframe 方式来加载下一页，无限套娃（适用于：部分动态加载内容的网站，需要允许 iframe 且支持通过 GET/POST 直接打开下一页）
           style:       加载 iframe 前要插入的 CSS Style 样式（比如为了悬浮的样式与下一页的重叠，隐藏网页底部间距提高阅读连续性）
           iframe:      这个必须加到 pager{} 外面（这样才会在该域名的 iframe 框架下运行脚本）

       6 = 通过 iframe 获取下一页动态加载内容插入本页，只有一个娃（适用于：部分动态加载内容的网站，与上面不同的是，该模式适合简单的网页，没有复杂事件什么的）
           loadTime:    预留的网页加载时间，确保网页内容加载完成（省略后默认为 300ms）

    nextL:    下一页链接所在元素
    pageE:    要从下一页获取的元素
    insertP:  下一页元素插入本页的位置（数组第一个是基准元素，第二个是基准元素的前后具体位置）
       1 = 插入基准元素自身的前面
       2 = 插入基准元素内，第一个子元素前面
       3 = 插入基准元素内，最后一个子元素后面
       4 = 插入基准元素自身的后面
       5 = 插入 pageE 列表最后一个元素的后面（该 insertP 可以直接省略不写，等同于 ['pageE', 5] ）
       6 = 插入该元素自身内部末尾（针对小说网站等文本类的），附带参数 insertP6Br: true, 用来中间插入换行
    // 小技巧：当基准元素是下一页主体元素的父元素时（或者说要将下一页元素插入到本页同元素最后一个后面时）是可以省略不写 insertP
         例如：当 pageE: 'ul>li' 且 insertP: ['ul', 3] 时，实际等同于 ['ul>li', 5]
               当 pageE: '.item' 且 insertP: ['.item', 4] 时，实际等同于 ['.item', 5]
               当 pageE: '.item' 且 insertP: ['.page', 1] 时，实际等同于 ['.item', 5]
         注意：如 pageE 中选择了多类元素，则不能省略 insertP（比如包含 `,` 与 `|` 符号），除非另外的选择器是 <script> <style> <link> 标签

    replaceE: 要替换为下一页内容的元素（比如页码），省略后将会自动判断是替换 nextL 元素还是 nextL 的父元素（当 nextL 元素后面或前面有 <a> 的相邻兄弟元素时替换其父元素，反之替换其自身，仅限模式1/3/6，且 js 代码除外），值为空 "" 时则完全不替换
    scrollD： 当 [滚动条] 与 [网页底部] 之间的距离 等于或小于该值时，将触发翻页，因此值越大就越早触发翻页，访问速度慢的网站需要调大，可省略(记得移除上一行末尾逗号)，省略后默认 2000

    scriptT:  单独插入 <script> 标签
       0 = 下一页的所有 <script> 标签
       1 = 下一页的所有 <script> 标签（不包括 src 链接）
       2 = 下一页主体元素 (pageE) 的同级 <script> 标签
       3 = 下一页主体元素 (pageE) 的子元素 <script> 标签

    interval:   翻页后间隔时间（省略后默认 500ms）
    forceHTTPS: 下一页链接强制 HTTPS
},
function: {
       bF = 插入前执行函数
       bFp = 参数
       aF = 插入后执行函数
       aFp = 参数
}
    */ //<<< 规则简单说明 >>>
        DBSite = {
            rule34: {
                host: ['rule34.xxx', 'www.rule34.xxx'],
                url: ()=> {if ((indexOF('page=favorites', 's') || indexOF('page=post', 's')) && getCSS('.image-list') && getCSS('#paginator')) {curSite = DBSite.rule34;}},
                pager: {
                    nextL: rule34_nextL,
                    pageE: '.image-list > span',
                    replaceE: '#paginator',
                    scrollD: 2500
                }
            } //               Rule34.xxx 图片列表/收藏页
        };
        // 不再读取/合并外置规则（menu_rules），避免之前缓存下来的其它网站规则重新混入；
        // 只合并 自定义规则、内置规则（注：Object.assign 合并对象时，同名会后者覆盖前者）
        let _customRules = GM_getValue('menu_customRules', {})
        if (Object.prototype.toString.call(_customRules) !== '[object Object]') {_customRules={};}
        DBSite = Object.assign({}, _customRules, DBSite);
        DBSite2 = structuredClone(_customRules); // DBSite2 是提供给 自定义翻页规则界面 - 所有规则 显示用的

        // 生成 SiteTypeID
        setSiteTypeID();
        //console.log(DBSite)
    }


    // --------------------------------------------------------


    // 判断网站类型
    webTypeIf();

    // 帖子内自动翻页判断
    if (!GM_getValue('menu_thread')) {if (curSite.thread) {curSite = {SiteTypeID: 0}; pageNum.now = 1;}}

    //console.log(curSite)
    // 显示页码
    if (GM_getValue('menu_page_number')) {pageNumber('add');} else {pageNumber('set');}
    // 左键双击网页空白处暂停翻页
    pausePageEvent();
    // 强制新标签页打开链接
    if (curSite.blank != undefined) setTimeout(forceTarget, 1000);
    // 初始化事件
    //if (curSite.initE != undefined) initEvent();

    // 对于使用 pjax 技术的网站，需要监听 URL 变化来重新判断翻页规则
    if (urlC) {
        nowLocation = location.href
        if (window.onurlchange === undefined) {addUrlChangeEvent();} // Tampermonkey v4.11 版本添加的 onurlchange 事件 grant，可以监控 pjax 等网页的 URL 变化
        if (webType === 1) {
            window.addEventListener('urlchange', function(){
                lp = location.pathname;
                //console.log(nowLocation, location.href)
                if (curSite.history !== false && window.top.document.Autopage_nowUrl === location.href) {nowLocation = location.href; return}
                if (nowLocation == location.href) return
                if (curSite.pager && curSite.pager.type == 5) {
                    if (self != top) {window.top.location.href = location.href;} else {if (getCSS('iframe#Autopage_iframe')) {getCSS('iframe#Autopage_iframe').remove();}}
                    pausePage = true;
                } // 对于翻页模式 5，如果是 iframe 框架内 URL 变动，则升级为顶级页面，如果是顶级页面的 URL 变动，则清理 iframe 框架
                nowLocation = location.href; curSite = {SiteTypeID: 0}; pageNum.now = 1; // 重置规则+页码
                registerMenuCommand(); // 重新判断规则

                //console.log(curSite);
                if (curSite.blank != undefined) setTimeout(forceTarget, 1000); // 强制新标签页打开链接
                //if (curSite.initE != undefined) initEvent(); // 初始化事件
                if (curSite.style) {insStyle(curSite.style)} // 插入 Style CSS 样式
                if (!GM_getValue('menu_thread')) {if (curSite.thread) {curSite = {SiteTypeID: 0}; pageNum.now = 1;}} // 帖子内自动翻页判断
                if (GM_getValue('menu_page_number')) {pageNumber('add');} else {pageNumber('set');} // 显示页码
                pausePageEvent(); // 左键双击网页空白处暂停翻页

                pageLoading();
            })
        }
    }
    // 插入 Style CSS 样式
    if (curSite.style) insStyle(curSite.style)

    // 自动无缝翻页
    pageLoading();


    // --------------------------------------------------------


    // [Rule34.xxx] 获取下一页地址（下一页按钮没有 href，需要从 onclick 属性里提取）
    function rule34_nextL() {
        let next = getCSS('#paginator a[name="next"]');
        if (!next) return '';
        let match = (next.getAttribute('onclick') || '').match(/document\.location='([^']+)'/);
        if (!match) return '';
        let url = location.origin + location.pathname + match[1];
        if (url === curSite.pageUrl) return '';
        return url;
    }


    // --------------------------------------------------------


    // 自动无缝翻页
    function pageLoading() {
        if (curSite.SiteTypeID === 0 || !curSite.pager) return
        if (curSite.pager.type === undefined) curSite.pager.type = 1; // 默认翻页模式 1
        if (curSite.pager.scrollD === undefined) curSite.pager.scrollD = 2000; // 默认翻页触发线 2000
        if (curSite.pager.interval === undefined) curSite.pager.interval = 500; // 默认间隔时间 500ms
        //console.log(curSite)
        curSite.pageUrl = ''; // 下一页URL
        windowScroll(function (direction, e) {
            // 下滑 且 未暂停翻页 且 SiteTypeID > 0 时，才准备翻页
            if (direction != 'down' || !pausePage || curSite.SiteTypeID == 0) return

            // 翻页模式 5 且为框架内时，要判断顶层是否通过页码暂停翻页了
            if (curSite.pager.type == 5 && self != top && window.top.document.xiu_pausePage == false) return

            let scrollTop = document.documentElement.scrollTop || window.pageYOffset || document.body.scrollTop,
                scrollHeight = window.innerHeight || document.documentElement.clientHeight,
                scrollD = curSite.pager.scrollD;
            // <<<<< 翻页类型 3（依靠 [基准元素] 与 [浏览器可视区域底部] 之间的距离缩小来触发翻页）>>>>>
            if (curSite.pager.type === 3) {
                if (!curSite.pager.scrollE) { // 当 scrollE 未指定时
                    if(curSite.pager.replaceE) { // 如果指定了 replaceE，则默认 scrollE 为 replaceE
                        curSite.pager.scrollE = curSite.pager.replaceE;
                    } else { // 如果 replaceE 也未指定，则默认 scrollE 为 nextL
                        curSite.pager.scrollE = curSite.pager.nextL;
                    }
                }
                let scrollE = getOne(curSite.pager.scrollE);
                //console.log(scrollE.offsetTop, scrollE.offsetTop - (scrollTop + scrollHeight), scrollD, scrollTop + scrollHeight, curSite.SiteTypeID)
                if (scrollE.offsetTop - (scrollTop + scrollHeight) <= scrollD) {intervalPause(); checkURL(getPageE);}

            } else if (document.documentElement.scrollHeight <= scrollHeight + scrollTop + scrollD) {
                // <<<<< 翻页类型 1（由脚本实现自动无缝翻页）>>>>>
                if (curSite.pager.type === 1) {
                    intervalPause(); checkURL(getPageE);

                    // <<<<< 翻页类型 2（网站自带了自动无缝翻页功能，只需要点击下一页按钮即可）>>>>>
                } else if (curSite.pager.type === 2) {
                    let autopbn = getOne(curSite.pager.nextL);
                    if (!autopbn) return
                    if (curSite.pager.isHidden && isHidden(autopbn)) return // 如果 isHidden = true，那么需要判断元素是否隐藏
                    if (curSite.pager.nextText) {
                        //console.log(curSite.pager.nextText, autopbn.innerText, autopbn)
                        // 按钮文本，当按钮文本 = 该文本时，才会点击按钮加载下一页
                        if (autopbn.innerText === curSite.pager.nextText) {autopbn.click(); pageNumIncrement();}
                    } else if (curSite.pager.nextTextOf) {
                        // 按钮文本的一部分，当按钮文本包含该文本时，才会点击按钮加载下一页
                        if (autopbn.innerText.indexOf(curSite.pager.nextTextOf) > -1) {autopbn.click(); pageNumIncrement();}
                    } else if (curSite.pager.nextHTML) {
                        // 按钮内元素，当按钮内元素 = 该元素内容时，才会点击按钮加载下一页
                        if (autopbn.innerHTML === curSite.pager.nextHTML) {autopbn.click(); pageNumIncrement();}
                    } else {
                        intervalPause();
                        // 如果没有指定按钮文字就直接点击
                        autopbn.click(); pageNumIncrement();
                    }

                    // <<<<< 翻页类型 4（部分简单的动态加载类网站）>>>>>
                } else if (curSite.pager.type === 4) {
                    intervalPause(); if (typeof curSite.pager.nextL == 'function') {curSite.pager.nextL();} else if (getNextE_(curSite.pager.nextL)) {getPageE_(curSite.pageUrl);}

                    // <<<<< 翻页类型 5（插入 iframe 方式来加载下一页）>>>>>
                } else if (curSite.pager.type === 5) {
                    checkURL(insIframe);

                    // <<<<< 翻页类型 6（通过 iframe 获取下一页动态加载内容）>>>>>
                } else if (curSite.pager.type === 6) {checkURL(insIframe_);}
            }
        });

        function intervalPause() {
            if (curSite.pager.interval) {
                pausePage = false
                setTimeout(function(){pausePage = true;}, curSite.pager.interval)
            }
        }
    }

    // 翻页类型 1/3
    function getPageE(url) {
        // Chrome 浏览器可以依靠改用原生 XMLHttpRequest 尝试解决因缺失跨域 cookie 导致的问题（比如一些使用 Cloudflare CDN 人机验证的网站，会出现脚本后台获取到人机验证页面）
        // Firefox 浏览器则需要使用 GM_xmlhttpRequest 的 cookiePartition 参数来解决（该参数要 Tampermonkey v5.2 及以上才有）
        // 如果翻页规则有 curSite.gmxhr 或是 Firefox 浏览器，则依然使用 GM_xmlhttpRequest+cookiePartition，反之则使用原生 XMLHttpRequest
        if (curSite.gmxhr || navigator.userAgent.includes('Firefox')) {
            GM_xmlhttpRequest({
                url: url,
                method: 'GET',
                //overrideMimeType: 'text/html; charset=' + (document.characterSet||document.charset||document.inputEncoding),
                responseType: 'arraybuffer', // Firefox 浏览器下 Tampermonkey 访问 GBK 网站时会乱码，只能改为 TextDecoder 手动转换编码
                headers: {
                    'x-requested-with': (curSite.xRequestedWith === true) ? 'XMLHttpRequest':null,
                    'Referer': (curSite.noReferer === true) ? null:location.href,
                    'Accept': 'text/html,application/xhtml+xml,application/xml'
                },
                cookiePartition: { // https://github.com/Tampermonkey/tampermonkey/issues/2057
                    topLevelSite: location.origin
                },
                timeout: 5000,
                onload: function (response) {
                    try {
                        //console.log('URL：' + url, '最终 URL：' + response.finalUrl, '返回内容：' + response.responseText, response)
                        processElems(createDocumentByString((new TextDecoder((document.characterSet||document.charset||document.inputEncoding))).decode(response.response)));
                        //processElems(createDocumentByString(response.responseText));
                    } catch (e) {
                        console.error('[自动无缝翻页] - 处理获取到的下一页内容时出现问题，请检查！\n', e, '\nURL：' + url, '\n最终 URL：' + response.finalUrl, '\n返回状态：' + response.statusText, '\n返回内容：' + response.responseText);
                    }
                },
                onerror: function (response) {
                    console.log('URL：' + url, response)
                    GM_notification({text: '❌ 获取下一页失败...', timeout: 5000});
                },
                ontimeout: function (response) {
                    setTimeout(function(){curSite.pageUrl = '';}, 3000)
                    console.log('URL：' + url, response)
                    GM_notification({text: '❌ 获取下一页超时，可 3 秒后再次滚动网页重试（或尝试刷新网页）...', timeout: 5000});
                }
            });
        } else {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.overrideMimeType('text/html; charset=' + (document.characterSet||document.charset||document.inputEncoding));

            if (curSite.xRequestedWith === true) {xhr.setRequestHeader('x-requested-with', 'XMLHttpRequest')}
            //(curSite.noReferer === true) ? xhr.setRequestHeader('Referer', ''):xhr.setRequestHeader('Referer', location.href)
            xhr.setRequestHeader('Accept', 'text/html,application/xhtml+xml,application/xml')

            xhr.timeout = 5000;
            xhr.onload = function() {
                try {
                    //console.log('URL：' + url, '最终 URL：' + xhr.responseURL, '返回内容：' + xhr.responseText)
                    processElems(createDocumentByString(xhr.responseText));
                } catch (e) {
                    console.error('[自动无缝翻页] - 处理获取到的下一页内容时出现问题，请检查！\n', e, '\nURL：' + url, '\n最终 URL：' + xhr.responseURL, '\n返回状态：' + xhr.statusText, '\n返回内容：' + xhr.responseText);
                }
            };
            xhr.onerror = function() {
                console.log('URL：' + url, xhr.statusText)
                GM_notification({text: '❌ 获取下一页失败...', timeout: 5000});
            };
            xhr.ontimeout = function() {
                setTimeout(function(){curSite.pageUrl = '';}, 3000)
                console.log('URL：' + url, xhr.statusText)
                GM_notification({text: '❌ 获取下一页超时，可 3 秒后再次滚动网页重试（或尝试刷新网页）...', timeout: 5000});
            };
            xhr.send();
        }
    }

    // 翻页类型 4
    function getPageE_(url, type = '', method = 'GET', data = '', type2) {
        let mimeType,accept;
        switch (type) {
            case 'json':
                accept = 'application/json'; mimeType = 'application/json; charset=' + (document.characterSet||document.charset||document.inputEncoding); break;
            case 'text':
                accept = 'text/plain'; mimeType = 'text/plain; charset=' + (document.characterSet||document.charset||document.inputEncoding); break;
            default:
                accept = 'text/html,application/xhtml+xml,application/xml'; mimeType = 'text/html; charset=' + (document.characterSet||document.charset||document.inputEncoding);
        }

        GM_xmlhttpRequest({
            url: url,
            method: method,
            data: data,
            responseType: type,
            overrideMimeType: mimeType,
            headers: {
                'Referer': (curSite.noReferer === true) ? null:location.href,
                'Content-Type': (method === 'POST') ? 'application/x-www-form-urlencoded':'',
                'Accept': accept
            },
            timeout: 5000,
            onload: function (response) {
                try {
                    //console.log('最终 URL：' + response.finalUrl, '返回内容：' + response.responseText)
                    switch (type) {
                        case 'json':
                            curSite.pager.insertE(response.response, type2);
                            break;
                        case 'text':
                            curSite.pager.insertE(response.responseText, type2)
                            break;
                        default:
                            curSite.pager.insertE(createDocumentByString(response.responseText), type2)
                    }
                } catch (e) {
                    console.log(e);
                }
            },
            onerror: function (response) {
                setTimeout(function(){curSite.pageUrl = '';}, 3000)
                console.log('URL：' + url, response)
                GM_notification({text: '❌ 获取下一页失败，可 3 秒后再次滚动网页重试（或尝试刷新网页）...', timeout: 5000});
            },
            ontimeout: function (response) {
                setTimeout(function(){curSite.pageUrl = '';}, 3000)
                console.log('URL：' + url, response)
                GM_notification({text: '❌ 获取下一页超时，可 3 秒后再次滚动网页重试（或尝试刷新网页）...', timeout: 5000});
            }
        });
    }
    // 翻页类型 5（插入 iframe 方式加载下一页，无限套娃）
    function insIframe(src) {
        // 停用当前页面翻页
        if (curSite.SiteTypeID == 0) return
        curSite.SiteTypeID = 0;

        // 创建 iframe
        let iframe = document.createElement('iframe');
        iframe.id = 'Autopage_iframe';
        iframe.src = src.replace(/#.+$/,'');

        document.documentElement.appendChild(document.createElement('style')).textContent = 'iframe#Autopage_iframe {position: absolute !important; width: 100% !important; height: 100% !important; border: none !important;}';

        var beforeScrollTop = document.documentElement.scrollTop || document.body.scrollTop
        // 当滚动条到底部时（即完全显示 iframe 框架），隐藏当前页面的滚动条
        window.addEventListener('scroll', function () {
            let scrollTop = document.documentElement.scrollTop || document.body.scrollTop,
                clientHeight = document.documentElement.clientHeight || document.body.clientHeight,
                scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight,
                afterScrollTop = document.documentElement.scrollTop || document.body.scrollTop,
                delta = afterScrollTop - beforeScrollTop;
            if (delta == 0) return false;
            beforeScrollTop = afterScrollTop;

            //console.log(delta, (scrollTop + clientHeight + 10), scrollHeight, '1111')
            if (delta > 0 && scrollTop + clientHeight + 10 >= scrollHeight && !getCSS('#Autopage_iframe-scroll')) {
                let newStyle = document.createElement('style'); newStyle.id = 'Autopage_iframe-scroll';
                newStyle.textContent = 'html::-webkit-scrollbar, body::-webkit-scrollbar {width: 0 !important;height: 0 !important;} html, body {scrollbar-width: none !important;}';
                if (curSite.pager.style) newStyle.textContent += curSite.pager.style;
                document.documentElement.appendChild(newStyle);

                // 恢复 iframe 的滚动条
                if (iframe.contentWindow.document.querySelectorAll('#Autopage_iframe-scroll-hidden')) iframe.contentWindow.document.querySelectorAll('#Autopage_iframe-scroll-hidden').forEach((o)=>{o.remove();});

                // 给予 iframe 焦点
                iframe.focus();
                if (iframe.contentWindow.document.body) {iframe.contentWindow.document.body.focus(); iframe.contentWindow.document.body.click();}
            } else if (delta < 0 && scrollTop + clientHeight + 10 <= scrollHeight && getCSS('#Autopage_iframe-scroll')) {
                getCSS('#Autopage_iframe-scroll').remove();
                // 再次禁用 iframe 的滚动条
                if (!iframe.contentWindow.document.getElementById('Autopage_iframe-scroll-hidden')) {
                    let newStyle = document.createElement('style'); newStyle.id = 'Autopage_iframe-scroll-hidden';
                    newStyle.textContent = 'html, body {overflow: hidden !important;}';
                    iframe.contentWindow.document.documentElement.appendChild(newStyle);
                }
            }
        }, false);

        // 加载完成后才继续
        iframe.onload = function() {
            // 暂时禁用 iframe 的滚动条
            if (!getCSS('#Autopage_iframe-scroll') && !iframe.contentWindow.document.getElementById('Autopage_iframe-scroll-hidden')) {

                let newStyle = document.createElement('style'); newStyle.id = 'Autopage_iframe-scroll-hidden';
                newStyle.textContent = 'html, body {overflow: hidden !important;}';
                iframe.contentWindow.document.documentElement.appendChild(newStyle);
            }

            // 添加历史记录
            if (curSite.history === undefined) {
                if (GM_getValue('menu_history', true)) addHistory(iframe.contentWindow.document, iframe.contentWindow.document.title);
            } else {
                if (curSite.history) addHistory(iframe.contentWindow.document, iframe.contentWindow.document.title);
            }
            // 当前页码 + 1
            if (!curSite.hiddenPN) {
                let autopageNumber = getCSS('#Autopage_number', window.top.document)
                if (autopageNumber) pageNumIncrement()
            }
        }

        // 插入 iframe
        if (location.hostname == 'www.cocomanga.com') {
            document.body.appendChild(iframe);
        } else {
            document.documentElement.appendChild(iframe);
        }
    }
    // 翻页类型 6（通过 iframe 获取下一页动态加载内容，只有一个娃）
    function insIframe_(src) {
        // 暂停翻页
        if (!pausePage) return
        pausePage = false

        //console.log('000',src)
        // 如果不存在，则创建一个 iframe
        let iframe = document.getElementById('Autopage_iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            //iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms';
            iframe.id = 'Autopage_iframe';
            iframe.src = src.replace(/#.+$/,'');

            document.documentElement.appendChild(document.createElement('style')).textContent = 'iframe#Autopage_iframe {position: absolute !important; top: -9999px !important; left: -9999px !important; width: 100% !important; height: 100% !important; border: none !important; z-index: -999 !important;}';
        }

        // 加载完成后才继续
        iframe.onload = function() {
            if (!curSite.pager.loadTime) curSite.pager.loadTime = 300; // 默认 300ms
            let time1 = 0 ,time2 = setInterval(function(){
                let scrollHeight = (iframe.contentWindow.document.documentElement.scrollHeight || iframe.contentWindow.document.body.scrollHeight)/10
                iframe.contentWindow.scrollTo(0, 999999);
                iframe.contentWindow.scrollTo(0, scrollHeight*time1);
                if (++time1 == 12) {
                    clearInterval(time2);
                    processElems(iframe.contentWindow.document); // 插入/替换元素等
                    pausePage = true; //      恢复翻页
                }
            }, curSite.pager.loadTime/10)
            }

        // 插入 iframe（如果已存在则直接改 src）
        if (document.getElementById('Autopage_iframe')) {
            iframe.src = src.replace(/#.+$/,'');
        } else {
            document.documentElement.appendChild(iframe);
        }
    }


    // XHR 后处理结果，插入、替换元素等（适用于翻页类型 1/3/6）
    function processElems(response) {
        if (!curSite.pager.insertP) {curSite.pager.insertP = [curSite.pager.pageE, 5]}
        let pageE = getAll(curSite.pager.pageE, response, response), toE;
        if (curSite.pager.insertP[1] === 5) { // 插入 pageE 列表最后一个元素的后面
            toE = toE5pop(getAll(curSite.pager.insertP[0]));
        } else {
            toE = getOne(curSite.pager.insertP[0]);
        }
        //console.log(curSite.pager.pageE, pageE, curSite.pager.insertP, toE)

        if (pageE.length > 0 && toE) {
            // 如果有插入前函数就执行函数
            if (curSite.function && curSite.function.bF) {
                if (curSite.function.bFp) { // 如果指定了参数
                    if (typeof(curSite.function.bF) == 'string') { // 如果是字符串，说明是自定义规则
                        pageE = new Function('pageE', 'bFp', 'fun', curSite.function.bF)(pageE, curSite.function.bFp, window.autoPage)
                    } else {
                        pageE = curSite.function.bF(pageE, curSite.function.bFp);
                    }
                } else {
                    if (typeof(curSite.function.bF) == 'string') { // 如果是字符串，说明是自定义规则
                        pageE = new Function('pageE', 'fun', curSite.function.bF)(pageE, window.autoPage)
                    } else {
                        pageE = curSite.function.bF(pageE);
                    }
                }
            }

            // 强制新标签页打开链接
            if (curSite.blank === 4 || curSite.blank === 5 || curSite.blank === 6) {pageE = forceTarget(pageE);}

            // 插入位置
            let addTo = getAddTo(curSite.pager.insertP[1]);

            // 插入新页面元素
            if (curSite.pager.insertP[1] === 6) { // 插入到目标内部末尾（针对文本，比如小说网页）
                let afterend = '';
                if (curSite.pager.insertP6Br === false) { // 这个基本上只有脚本内置的通用规则会用上，因为该通用规则匹配到的网站正文 <br> 是未知的，所以需要判断一下数量
                    if (unsafeWindow.insertP6Br === true) {
                        afterend += '<br/><br/>'
                    } else if (unsafeWindow.insertP6Br === undefined) {
                        if (getAll('br', getOne(curSite.pager.pageE)).length > 10) {

                            function checklastElementsBr(e) {
                                const children = Array.from(e.childNodes).filter(node => {return node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');}), lastElement = children[children.length - 1];
                                if (lastElement.tagName === 'BR') { // 判断最后一个元素
                                    return true; // 最后一个元素是 <br>
                                } else if (lastElement.tagName === 'P' && lastElement.classList.contains('readinline')) { // 判断倒数第二个元素
                                    return children[children.length - 2].tagName === 'BR'; // 倒数第二个元素是 <br>
                                }
                                return false; // 其他情况
                            };
                            // 如果正文末尾最后一个元素不是 <br> 且 倒数第二个元素也不是 <br> 时，才添加 <br/><br/>
                            if (!checklastElementsBr(getOne(curSite.pager.pageE))) {
                                unsafeWindow.insertP6Br = true;
                                afterend += '<br/><br/>'
                            } else {unsafeWindow.insertP6Br = false;}
                        }
                    }
                } else if (curSite.pager.insertP6Br) { // 对于其他 insertP6Br: true 的规则，则依然直接添加 <br>
                    afterend += '<br/><br/>'
                }
                pageE.forEach(function (one) {afterend += one.innerHTML;});
                toE.insertAdjacentHTML(addTo, afterend);
            } else {
                if (curSite.pager.insertP[1] === 2 || curSite.pager.insertP[1] === 4 || curSite.pager.insertP[1] === 5) pageE.reverse(); // 插入到 [元素内头部]、[目标本身后面] 时，需要反转顺序
                pageE.forEach(function (one) {toE.insertAdjacentElement(addTo, one);});
            }

            // 当前页码 + 1
            pageNumIncrement()

            // 添加历史记录
            if (curSite.history === undefined) {
                if (GM_getValue('menu_history', true)) addHistory(response);
            } else {
                if (curSite.history) addHistory(response);
            }

            // 替换待替换元素
            if (curSite.pager.replaceE !== "") replaceElems(response);

            // 插入 <script> 标签
            if (curSite.pager.scriptT || curSite.pager.scriptT == 0) {
                switch (curSite.pager.scriptT) {
                    case 0: // 下一页的所有 <script> 标签
                        insScript('script', response); break;
                    case 1: // 下一页的所有 <script> 标签（不包括 src 链接）
                        insScript('script:not([src])', response); break;
                    case 2: // 下一页主体元素 (pageE) 的同级 <script> 标签
                        if (curSite.pager.insertP[1] === 2 || curSite.pager.insertP[1] === 4 || curSite.pager.insertP[1] === 5) pageE.reverse(); // 为了避免 JS 执行顺序反了，还需要再给反转回去
                        insScript(null, pageE); break;
                    case 3: // 下一页主体元素 (pageE) 的子元素 <script> 标签
                        if (curSite.pager.insertP[1] === 2 || curSite.pager.insertP[1] === 4 || curSite.pager.insertP[1] === 5) pageE.reverse(); // 为了避免 JS 执行顺序反了，还需要再给反转回去
                        insScript('script:not([src])', pageE); break;
                }
            }

            // 如果有插入后函数就执行函数
            if (curSite.function && curSite.function.aF) {
                if (curSite.function.aFp) { // 如果指定了参数
                    if (typeof(curSite.function.aF) == 'string') { // 如果是字符串，说明是自定义规则
                        new Function('aFp', 'fun', curSite.function.aF)(curSite.function.aFp, window.autoPage)
                    } else {
                        curSite.function.aF(curSite.function.aFp);
                    }
                } else {
                    if (typeof(curSite.function.aF) == 'string') { // 如果是字符串，说明是自定义规则
                        new Function('fun', curSite.function.aF)(window.autoPage);
                    } else {
                        curSite.function.aF();
                    }
                }
            }
        } else { // 获取主体元素失败后，尝试重新获取
            console.log(curSite.pager.pageE, pageE, curSite.pager.insertP, toE, response)
            if (curSite.retry) {
                console.warn('[自动无缝翻页] 获取主体元素失败，' + curSite.retry + '毫秒 后可向下翻网页来触发脚本尝试重新获取...')
                setTimeout(function(){curSite.pageUrl = '';}, curSite.retry)
            } else {
                console.error('[自动无缝翻页] 获取主体元素失败...')
                // 尝试替换元素看能不能继续翻页下去
                /*if (curSite.pager.replaceE !== "") {
                    if (replaceElems(response)) { // 如果替换成功
                        console.log('[自动无缝翻页] 获取主体元素失败，尝试替换元素成功！')
                        // 当前页码 + 1
                        pageNumIncrement();
                        // 添加历史记录
                        if (curSite.history === undefined) {
                            if (GM_getValue('menu_history', true)) addHistory(response);
                        } else {
                            if (curSite.history) addHistory(response);
                        }
                    } else {console.error('[自动无缝翻页] 获取主体元素失败，尝试替换元素失败...')}
                }*/
            }
        }
    }
    // 通用型获取下一页地址（从 元素 中获取页码）该函数仅供脚本内部调用
    function getNextE_(css) {
        if (!css) css = curSite.pager.nextL; // 如果没有指定 css 参数，那么就使用规则中的 nextL
        let next = getOne(css); // 获取含有下一页地址的元素
        if (next && next.nodeType === 1 && next.href && next.href.slice(0,4) === 'http' && next.getAttribute('href').slice(0,1) !== '#') { // 确定元素存在且 href 是正常链接
            if (next.href != curSite.pageUrl) { // 如果取到的下一页 URL 和上一次取到的 URL（也就是当前 URL）不一样
                if (curSite.pager.forceHTTPS && location.protocol === 'https:') { // 如果规则要求强制 HTTPS，且当前网页的协议也是 HTTPS，那么就需要修改 URL 为 HTTPS
                    if (next.href.replace(/^http:/,'https:') === curSite.pageUrl) {return false;} // 如果修改为 HTTPS 后和上一次取到的 URL（也就是当前 URL）一样，就返回 false
                    curSite.pageUrl = next.href.replace(/^http:/,'https:'); // 反之返回修改 HTTPS 后的 URL
                } else {
                    curSite.pageUrl = next.href;
                }
            } else { // 如果取到的下一页 URL 和上一次取到的 URL（也就是当前 URL）一样，那么代表没有下一页了，就返回 false
                return false;
            }
            //console.log(curSite.pageUrl)
            return true;
        }
        return false; // 如果元素不存在 或 href 非正常链接，就返回false
    }
    // 通用型获取下一页地址（从 元素 中获取页码）该函数用于规则中调用（fun.getNextE() 这样）
    function getNextE(css) {
        if (!css) { // 考虑到可能被非 nextL 规则内调用，所以还是需要做一个判断
            if (typeof curSite.pager.nextL == 'string' && curSite.pager.nextL.match(/^js;/i) === null) {css = curSite.pager.nextL;} else {return '';}
        }
        let next = getOne(css); // 获取含有下一页地址的元素
        if (next && next.nodeType === 1 && next.href && next.href.slice(0,4) === 'http' && next.getAttribute('href').slice(0,1) !== '#') { // 确定元素存在且 href 是正常链接
            if (next.href != curSite.pageUrl) { // 如果取到的下一页 URL 和上一次取到的 URL（也就是当前 URL）不一样
                if (curSite.pager.forceHTTPS && location.protocol === 'https:') { // 如果规则要求强制 HTTPS，且当前网页的协议也是 HTTPS，那么就需要修改 URL 为 HTTPS
                    if (next.href.replace(/^http:/,'https:') === curSite.pageUrl) {return '';} // 如果修改为 HTTPS 后和上一次取到的 URL（也就是当前 URL）一样，就返回空
                    return next.href.replace(/^http:/,'https:'); // 反之返回修改 HTTPS 后的 URL
                } else {
                    return next.href;
                }
            } else { // 如果取到的下一页 URL 和上一次取到的 URL（也就是当前 URL）一样，那么代表没有下一页了，就返回空
                return '';
            }
        }
        return ''; // 如果元素不存在 或 href 非正常链接，就返回空
    }
    // 通用型获取下一页地址（从 元素 中获取页码，URL 替换 page= 参数）
    function getNextEP(css, pf, reg) {
        let nextNum = getOne(css), url = '';
        if (nextNum && nextNum.textContent) {
            nextNum = nextNum.textContent.replaceAll(' ','');
            if (location.search) {
                if (indexOF(pf, 's')) {
                    url = location.search.replace(reg, pf + nextNum);
                } else {
                    url = location.search + '&' + pf + nextNum;
                }
            } else {
                url = '?' + pf + nextNum;
            }
            url = location.origin + location.pathname + url;
        }
        //console.log('111', url)
        return url
    }
    // 通用型获取下一页地址（直接给定页码，URL 替换 page= 参数）
    function getNextSP(page, pf, reg) {
        let url = '';
        if (!page) return url
        if (typeof page === 'number') page = page.toString()
        if (location.search) {
            if (indexOF(pf, 's')) {
                url = location.search.replace(reg, pf + page);
            } else {
                url = location.search + '&' + pf + page;
            }
        } else {
            url = '?' + pf + page;
        }
        return (location.origin + location.pathname + url)
    }
    // 通用型获取下一页地址（从 元素 中获取页码，URL 替换 pathname 路径）
    function getNextEPN(css, reg, a, b = '') {
        let nextNum = getOne(css), url = '';
        if (nextNum && nextNum.textContent) {
            nextNum = nextNum.textContent.replaceAll(' ','');
            if (location.pathname) {
                if (indexOF(reg)) {
                    url = location.pathname.replace(reg, a + nextNum + b);
                } else {
                    url = location.pathname + a + nextNum + b;
                }
            } else {
                url = location.pathname + a + nextNum + b;
            }
            url = location.origin + url + location.search;
        }
        return url
    }
    // 通用型获取下一页地址（从 URL 中获取页码，并页码+1，URL 替换 pathname 路径，后三个参数可以省略）
    function getNextUPN(urlReg, reg, a, b = '', initP = '2', endP) {
        let nextNum = urlReg.exec(location.pathname);
        if (nextNum) {
            if (nextNum.length > 1){ // 如果正则捕获到分组（也就是正则表达式中用英文括号括起来的），那么就改为使用第一个分组（也就是正则常说的 $1）作为当前页码数字
                nextNum = String(parseInt(nextNum[1])+1);
            } else {
                nextNum = String(parseInt(nextNum[0])+1);
            }
            if (endP && (parseInt(nextNum) > parseInt(endP))) return ''
        } else {
            nextNum = initP;
            if (endP && (parseInt(nextNum) > parseInt(endP))) return ''
        }
        let url = '';
        if (location.pathname) {
            if (indexOF(reg)) {
                url = location.pathname.replace(reg, a + nextNum + b);
            } else {
                url = location.pathname + a + nextNum + b;
            }
        } else {
            url = location.pathname + a + nextNum + b;
        }
        url = location.origin + url + location.search;
        return url
    }
    // 通用型获取下一页地址（从 URL 中获取页码，并页码+1，URL 替换 page= 参数，后三个参数可以省略）
    function getNextUP(pf, reg, lp = location.pathname, initP = '2', endP) {
        let nextNum = getSearch(pf.replace('=','')); // 获取参数中的 page= 值
        if (nextNum) { // 如果参数中存在 page=
            nextNum = String(parseInt(nextNum)+1); // 下一页页码就是当前页码参数值 +1
            if (endP && (parseInt(nextNum) > parseInt(endP))) return '' // 如果 endP 为真且 下一页页码 大于 endP(页码最大值)则终止
        } else { // 如果参数中不存在 page=
            nextNum = initP; // 因为不存在，所以一般都代表当前是位于第 1 页，那么下一页页码就设置为初始页码（默认 2）
            if (endP && (parseInt(nextNum) > parseInt(endP))) return '' // 如果 endP 为真且 下一页页码 大于 endP(页码最大值)则终止
        }
        let url = '';
        if (location.search) {
            if (indexOF(pf, 's')) {
                url = location.search.replace(reg, pf + nextNum);
            } else {
                url = location.search + '&' + pf + nextNum;
            }
        } else {
            url = '?' + pf + nextNum;
        }
        url = location.origin + lp + url;
        return url
    }
    // 通用型获取下一页地址（从 form input 中获取，返回 GET URL）
    function getNextF(css) {
        let form = getOne(css), value = '';
        if (form) {
            form.querySelectorAll('input[name]').forEach(function(input) {value += input.name + '=' + input.value + '&';}) // 生成表单参数
            value = encodeURI(value.replace(/&$/,'')); // 清理最后一个 & 符号
            if (form.action && value) return (form.action + '?' + value)
        }
        return '';
    }


    // 检查 URL
    function checkURL(func) {
        if (!curSite.pager.nextL) return
        if (typeof curSite.pager.nextL == 'function') {
            let tempUrl = curSite.pager.nextL();
            if (!tempUrl || tempUrl === curSite.pageUrl || tempUrl.slice(0,4) !== 'http') return
            curSite.pageUrl = tempUrl;
            func(curSite.pageUrl);
        } else if (curSite.pager.nextL.search(/^js;/i) === 0) { // 自定义翻页规则中执行 JavaScript 代码的
            try {
                let tempUrl = new Function('fun', curSite.pager.nextL.slice(3))(window.autoPage);
                if (!tempUrl || tempUrl === curSite.pageUrl || tempUrl.slice(0,4) !== 'http') return
                curSite.pageUrl = tempUrl;
                func(curSite.pageUrl);
            } catch (e) {
                console.error('[自动无缝翻页] - 当前网页规则 "nextL" 内 JS 代码有误，请检查：\n', curSite.pager.nextL + '\n\n', e);
            }
        } else if (getNextE_()) {
            func(curSite.pageUrl);
        }
        //console.log(curSite.pageUrl);
    }
    // 替换元素
    function replaceElems(pageE, o = curSite.pager.replaceE, r = curSite.pager.replaceE) {
        let oE,rE;

        if (curSite.pager.replaceE === undefined && curSite.pager.nextL && curSite.pager.nextL.search(/^js;/i) !== 0) { // 如果 replaceE 不存在，且 nextL 存在，且不是 js 代码
            let a = getOne(curSite.pager.nextL) // 获取 nextL 元素，并判断该元素后面或前面是否有同类型的相邻兄弟元素
            if ((a.nextElementSibling && a.nextElementSibling.tagName === a.tagName) || (a.previousElementSibling && a.previousElementSibling.tagName === a.tagName)) {
                // nextL 元素后面或前面有同类型的相邻兄弟元素，则可以替换 nextL 的父元素
                // 当 nextL 选择器为 xpath 时，直接末尾追加 /.. 即可选择其父元素
                if (curSite.pager.nextL.slice(0,1) === '/' || curSite.pager.nextL.slice(0,2) === './' || curSite.pager.nextL.slice(0,2) === '(/' || curSite.pager.nextL.slice(0,3) === 'id(') {
                    o = r = curSite.pager.nextL + '/..'
                } else { // 当 nextL 选择器为 css 时，则需要寻找所有 nextL 元素的父元素
                    oE = getAllParentElement(curSite.pager.nextL)
                    rE = getAllParentElement(curSite.pager.nextL, pageE, pageE)
                }
            } else { // 如果 nextL 元素后面或前面没有同类型的相邻兄弟元素，那么就只替换 nextL 元素
                o = r = curSite.pager.nextL
            }
        }

        if (!oE && !rE && o && r) {
            oE = getAll(o)
            rE = getAll(r, pageE, pageE)
        }

        if (oE && rE && oE.length != 0 && rE.length != 0 && oE.length === rE.length) {
            for (let i = 0; i < oE.length; i++) {
                oE[i].outerHTML = rE[i].outerHTML;
            }
            return true
        } else if (curSite.pager.replaceE !== undefined) {console.log(pageE,oE,rE)}
        return false
    }
    // 添加历史记录
    function addHistory(pageE, title, url) {
        if (!curSite.pageUrl) return
        // 对于自带类似功能 或者 覆盖了 history 原生函数的网站，则跳过不再添加历史记录
        if (window.top.history.toString() !== '[object History]') return
        title = title || ((pageE.querySelector('title')) ? pageE.querySelector('title').textContent : window.top.document.title);
        url = url || curSite.pageUrl;
        window.top.document.Autopage_nowUrl = curSite.pageUrl;
        // 对于下一页 URL 和当前网页 URL 的协议不同时，以当前网页 URL 协议为准
        if (url.indexOf(window.top.location.protocol) === -1) url = url.replace(/^https?:/,window.top.location.protocol)
        window.top.history.pushState('Autopage_history', title, url);
        window.top.document.title = title;
    }
    // 插入 <Script>
    function insScript(selector, contextNode = document, toE = document.body) {
        let scriptElems = contextNode;
        if (selector) {
            if (contextNode instanceof Array) {
                scriptElems = []; contextNode.forEach(function (one) {scriptElems = scriptElems.concat(getAll(selector, one, one));})
            } else {
                scriptElems = getAll(selector, contextNode, contextNode);
            }
        }

        scriptElems.forEach(function (one) {
            if (one.tagName === 'SCRIPT') {
                if (one.src) {
                    toE.appendChild(document.createElement('script')).src = one.src;
                } else {
                    toE.appendChild(document.createElement('script')).textContent = one.textContent;//.replaceAll('document.write', '');
                }
            }
        });
    }
    // 插入 <Style>
    function insStyle(style) {
        if (style.indexOf('{') === -1){style += '{display: none !important;}'}
        document.documentElement.appendChild(document.createElement('style')).textContent = style;
    }


    // 获取元素（CSS/Xpath）来自：https://github.com/machsix/Super-preloader
    function getCSS(css, contextNode = document) {
        return contextNode.querySelector(css);
    }
    function getAllCSS(css, contextNode = document) {
        return [].slice.call(contextNode.querySelectorAll(css));
    }
    function getXpath(xpath, contextNode, doc = document) {
        contextNode = contextNode || doc;
        try {
            const result = doc.evaluate(xpath, contextNode, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            // 应该总是返回一个元素节点
            return result.singleNodeValue && result.singleNodeValue.nodeType === 1 && result.singleNodeValue;
        } catch (err) {
            throw new Error(`无效 Xpath: ${xpath}`);
        }
    }
    function getAllXpath(xpath, contextNode, doc = document) {
        contextNode = contextNode || doc;
        const result = [];
        try {
            const query = doc.evaluate(xpath, contextNode, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < query.snapshotLength; i++) {
                const node = query.snapshotItem(i);
                // 如果是 Element 节点
                if (node.nodeType === 1) result.push(node);
            }
        } catch (err) {
            throw new Error(`无效 Xpath: ${xpath}`);
        }
        return result;
    }
    function getOne(selector, contextNode = undefined, doc = document) {
        if (!selector) return;
        contextNode = contextNode || doc;
        if (selector.slice(0,1) === '/' || selector.slice(0,2) === './' || selector.slice(0,2) === '(/' || selector.slice(0,3) === 'id(') {
            return getXpath(selector, contextNode, doc);
        } else {
            return getCSS(selector, contextNode);
        }
    }
    function getAll(selector, contextNode = undefined, doc = document) {
        if (!selector) return [];
        contextNode = contextNode || doc;
        if (selector.slice(0,1) === '/' || selector.slice(0,2) === './' || selector.slice(0,2) === '(/' || selector.slice(0,3) === 'id(') {
            return getAllXpath(selector, contextNode, doc);
        } else {
            return getAllCSS(selector, contextNode);
        }
    }
    // 获取所有父元素
    function getAllParentElement(selector, contextNode = undefined, doc = document) {
        contextNode = contextNode || doc;
        const parents = [];
        getAll(selector, contextNode, doc).forEach((next) => {
            const parent = next.parentElement;
            if (!parents.includes(parent)) {
                parents.push(parent);
            }
        });
        return parents
    }
    function createDocumentByString(e) {
        if (e) {
            if ('HTML' !== document.documentElement.nodeName) return (new DOMParser).parseFromString(e, 'application/xhtml+xml');
            var t;
            try { t = (new DOMParser).parseFromString(e, 'text/html');} catch (e) {}
            if (t) return t;
            if (document.implementation.createHTMLDocument) {
                t = document.implementation.createHTMLDocument('ADocument');
            } else {
                try {((t = document.cloneNode(!1)).appendChild(t.importNode(document.documentElement, !1)), t.documentElement.appendChild(t.createElement('head')), t.documentElement.appendChild(t.createElement('body')));} catch (e) {}
            }
            if (t) {
                var r = document.createRange(),
                    n = r.createContextualFragment(e);
                r.selectNodeContents(document.body);
                t.body.appendChild(n);
                for (var a, o = { TITLE: !0, META: !0, LINK: !0, STYLE: !0, BASE: !0}, i = t.body, s = i.childNodes, c = s.length - 1; c >= 0; c--) o[(a = s[c]).nodeName] && i.removeChild(a);
                return t;
            }
        } else console.error('没有找到要转成 DOM 的字符串', e);
    }


    // 兼容不支持 GM_openInTab 的油猴脚本管理器
    function openInTab(url, options) {
        window.open(url);
    }

    // 强制新标签页打开链接
    function forceTarget(pageE) {
        if (curSite.blank === 1) {
            document.head.appendChild(document.createElement('base')).target = '_blank';

        } else if (curSite.blank === 5 || curSite.blank === 6) { // 清理 <a> 元素的点击事件
            if (!pageE) pageE = getAll(curSite.pager.pageE)
            pageE.forEach(function (dd) {
                getAllCSS('a[href]:not([target="_blank"]):not([href^="#"]):not([href^="javascript:"])',dd).forEach(function (a) {
                    if (a.href.slice(0,4) == 'http') {
                        const clonedLink = a.cloneNode(true); // 克隆原 a 元素
                        clonedLink.target = '_blank'; // 通过添加 target="_blank" 属性来新标签页打开，可以解决大部分情况
                        if (curSite.blank === 6) clonedLink.addEventListener('click', function(e) {e.stopPropagation();}); // 如果添加 target="_blank" 属性无效（依然在当前网页跳转打开），那么说明其父元素的事件委托中阻止了默认打开链接事件，因此对该 <a> 元素添加点击事件并阻止冒泡（避免父元素事件委托捕获该元素的点击事件）
                        a.insertAdjacentElement('afterend', clonedLink); // 把克隆的元素插入原 a 元素后面
                        a.remove(); // 删除原 a 元素
                    }
                });
            });
            return pageE

        } else if (curSite.blank === 4) {
            if (!pageE) pageE = getAll(curSite.pager.pageE)
            pageE.forEach(function (dd) {getAllCSS('a[href]:not([target="_blank"]):not([onclick]):not([href^="#"]):not([href^="javascript:"])',dd).forEach(function (a) {if (a.href.slice(0,4) == 'http') {a.target = '_blank';}});});
            return pageE

        } else {
            let d;
            if (curSite.blank === 2) {
                d = document.body
            } else if (curSite.blank === 3) {
                let dd = toE5pop(getAll(curSite.pager.pageE));
                if (dd && dd.parentElement != null) d = dd.parentElement
            }
            if (!d) return

            function forceTarget_(target, e){
                if (target.href && target.target != '_blank' && !(target.getAttribute('onclick')) && target.href.slice(0,4) == 'http' && target.getAttribute('href').slice(0,1) != '#') {
                    e.stopPropagation(); // 阻止冒泡（避免被父元素事件委托捕获）
                    e.preventDefault(); // 阻止默认打开链接事件
                    GM_openInTab(target.href, {active: true,insert: true,setParent: true});
                }
            }
            d.addEventListener('click', function(e) {
                //console.log(e.target.tagName, e.path)
                if (e.target.tagName === 'A') {
                    forceTarget_(e.target, e);
                } else {
                    let path = e.path || e.composedPath();
                    for (let i = 1; i < path.length - 4; i++) {if (path[i].tagName === 'A') {forceTarget_(path[i], e); break;}}
                }
            });
        }
    }

    // 清理元素上绑定的事件（不包括父元素上监听的事件委托）
    // css 为元素选择器（也支持 Xpath）
    // delay 为延迟时间，确保其放在 url 规则中执行时网页已经加载完成
    // mode 为 0 时清理全部，为 1 时额外清理 onclick 属性，为 2 时添加空点击事件并阻止冒泡
    function cleanuEvent(css, delay = 0, mode = -1) {
        setTimeout(()=>{
            getAll(css).forEach(function (a) {
                const clonedLink = a.cloneNode(true); // 克隆原元素
                if (mode == 0 || mode == 1) {if (clonedLink.getAttribute('onclick') != undefined) {clonedLink.removeAttribute('onclick')}} // 清理 onclick 属性
                if (mode == 0 || mode == 2) clonedLink.addEventListener('click', function(e) {e.stopPropagation();}); // 添加空点击事件并阻止冒泡（避免父元素事件委托捕获该元素的点击事件）
                a.insertAdjacentElement('afterend', clonedLink); // 把克隆的元素插入原元素后面
                a.remove(); // 删除原元素
            }, delay);
        })
    }
    // 初始化事件
    /*function initEvent() {
        if (curSite.initE[1] == undefined) curSite.initE[1] = 500;
        setTimeout(function(){getAllCSS(curSite.initE[0]).forEach(function (o) {o.innerHTML = o.innerHTML;});}, curSite.initE[1])
    }*/
    // 判断元素是否隐藏（隐藏返回 true）
    function isHidden(el){
        return (el.offsetParent === null);
    }
    // 判断是否为手机版（是则返回 true）
    function isMobile(){
        return (/(phone|pad|pod|iPhone|iPod|ios|iPad|Android|Mobile|BlackBerry|MicroMessenger|IEMobile|MQQBrowser|JUC|Fennec|wOSBrowser|BrowserNG|WebOS|Symbian|Windows Phone)/i.test(navigator.userAgent) || (window.screen.width < 500 && window.screen.height < 800));
    }
    // 用以自定义规则中设置 urlC = true
    function isUrlC(){
        urlC = true;
    }
    // 判断 URL 是否存在指定文本
    function indexOF(e, l = 'p', low = true){
        switch (l) {
            case 'h':
                l = location.href; break;
            case 'p':
                l = location.pathname; break;
            case 's':
                l = location.search; break;
        }
        //console.log(l,e,l.indexOf(e))
        if (e instanceof RegExp) {
            if (e.test(l)) return true
        } else {
            if (low) {e = e.toLowerCase(); l = l.toLowerCase();} // 全部转为小写（即不区分大小写）
            if (l.indexOf(e) != -1) return true
        }
        return false
    }
    // 判断网站标题是否包含指定文字
    function isTitle(title) {
        return document.title.indexOf(title) > -1;
    }
    // 判断规则中的 nextL、pageE、insertP、replaceE 元素是否存在于当前网页
    function isPager(type) {
        if (!type) { // 如果没有指定要判断的元素类型参数，那么需要设置默认值
            if (!DBSiteNow.pager) return false; // 如果连 pager 都没有，那么直接返回 false
            if (DBSiteNow.pager.type === undefined || DBSiteNow.pager.type === 1 || DBSiteNow.pager.type === 3 || DBSiteNow.pager.type === 6) { // 如果是翻页模式 1 3 6，那么默认值可能是 n、p、n,p 三种
                // 判断 nextL 是不是选择器（字符串 + 非 js; 开头）
                if (typeof DBSiteNow.pager.nextL == 'string' && DBSiteNow.pager.nextL.match(/^js;/i) === null) {type = 'n';}
                // 判断 pageE 是否不是空
                if (DBSiteNow.pager.pageE) {
                    // 如果 type 是空的，说明上面 nextL 判断结果为否，那么就是 p，反之则就是 n,p
                    if (!type) {type = 'p';}else{type = 'n,p';}
                }
            } else if (DBSiteNow.pager.type === 2 || DBSiteNow.pager.type === 5) { // 如果是翻页模式 2 6，那么默认值只能是 n 一种
                // 判断 nextL 是不是选择器（字符串 + 非 js; 开头）
                if (typeof DBSiteNow.pager.nextL == 'string' && DBSiteNow.pager.nextL.match(/^js;/i) === null) {type = 'n';}
            } else if (DBSiteNow.pager.type === 4) { // 如果是翻页模式 4，那么是不能使用 isPager 的（因为基本上都是脚本内的函数）
                return false;
            }
            if (!type) return false; // 如果上面的判断中 nextL 和 pageE 都为否，那么 type 就还是空的，则直接返回 false
        }
        const typeArr = type.split(',');
        for (let i = 0; i < typeArr.length; i++) {
            switch (typeArr[i]) {
                case 'n': // nextL
                    if (!getOne(DBSiteNow.pager.nextL)){return false;}; break;
                case 'p': // pageE
                    if (!getOne(DBSiteNow.pager.pageE)){return false;}; break;
                case 'i': // insertP
                    if (!getOne(DBSiteNow.pager.insertP[0])){return false;}; break;
                case 'r': // replaceE
                    if (!getOne(DBSiteNow.pager.replaceE)){return false;}; break;
            }
        }
        return true;
    }
    // 获取 Search 指定参数
    function getSearch(variable) {
        let query = window.location.search.substring(1),
            vars = query.split('&');
        for (var i=0;i<vars.length;i++) {
            var pair = vars[i].split('=');
            if(pair[0] == variable){return pair[1];}
        }
        return '';
    }
    // 启用/禁用 (当前网站)
    function menu_disable(type) {
        switch(type) {
            case 'check':
                return check(); break;
            case 'add':
                add(); break;
            case 'del':
                del(); break;
        }

        function check() { // 存在返回真，不存在返回假
            if (GM_getValue('menu_disable').indexOf(location.hostname) == -1) return false // 不存在返回假
            return true
        }

        function add() {
            if (check()) return
            let list = GM_getValue('menu_disable'); // 读取网站列表
            list.push(location.hostname); // 追加网站域名
            GM_setValue('menu_disable', list); // 写入配置
            location.reload(); // 刷新网页
        }

        function del() {
            if (!check()) return
            let list = GM_getValue('menu_disable'), // 读取网站列表
            index = list.indexOf(location.hostname);
            list.splice(index, 1); // 删除网站域名
            GM_setValue('menu_disable', list); // 写入配置
            location.reload(); // 刷新网页
        }
    }
    // 左键双击网页空白处暂停翻页
    function pausePageEvent() {
        if (!GM_getValue('menu_pause_page')) return
        if (curSite.SiteTypeID === 0) return
        if (curSite.pager && curSite.pager.type == 5) window.top.document.xiu_pausePage = pausePage
        document.body.addEventListener('dblclick', function () {
            if (pausePage) {GM_notification({text: `❌ 已暂停本页 [自动无缝翻页]\n    （再次双击可恢复）`, timeout: 2000});} else {GM_notification({text: `✅ 已恢复本页 [自动无缝翻页]\n    （再次双击可暂停）`, timeout: 2000});}
            if (document.querySelector('#Autopage_number')) { // 如果同时开启了左下角页码功能，则模拟点击（为了数字变成红色+斜体）
                document.querySelector('#Autopage_number').shadowRoot.querySelector('#Autopage_number_button').click();
            } else {
                pausePage = !pausePage;
                if (curSite.pager && curSite.pager.type == 5) window.top.document.xiu_pausePage = pausePage
            }
        });
    }
    // 自定义翻页规则
    function customRules() {
        if (getCSS('#Autopage_customRules')) return

        let customRules = customStringify(GM_getValue('menu_customRules', {}))
        if (customRules == '{}') customRules = '{\n    \n}'; // 引导用户插入规则的位置
        let _html = `<style>* {font-family: system-ui !important;}</style><div style="left: 0; right: 0; top: 0; bottom: 0; width: 100%; height: 100%; margin: auto; padding: 25px 10px 10px 10px; position: fixed; opacity: 0.95; z-index: 9999999; background-color: #eee; color: #222; font-size: 14px; overflow: scroll; text-align: left;-webkit-touch-callout: text !important;-webkit-user-select: text !important;-khtml-user-select: text !important;-moz-user-select: text !important;-ms-user-select: text !important;user-select: text !important;">
<h3 style="font-size: 22px;overflow: hidden;text-overflow: ellipsis;white-space: nowrap;"><strong># 自定义翻页规则（优先级最高，会覆盖同名的外置翻页规则）-【将规则插入默认的 <code>{ }</code> 中间】</strong></h3>
<details><summary style="cursor: pointer;overflow: hidden;text-overflow: ellipsis;white-space: nowrap;"><kbd><strong>「 点击展开 查看规则示例 」（为了避免需要的时候还要找，我干脆把常用规则都一股脑塞进去了）</strong></kbd></summary>
<ul style="list-style: disc; margin-left: 35px;">
<li>翻页规则为 JSON 格式，因此大家需要多少<strong>了解一点 JSON 的基本格式</strong>（主要就是末尾逗号、转义、双引号等）。</li>
<li>具体的翻页规则说明、示例，为了方便更新及补充，我都写到 <strong><a href="https://github.com/XIU2/UserScript/issues/176" target="_blank">Github Issues</a></strong> 里面了。</li>
<li>脚本会自动格式化规则，因此<strong>无需手动缩进、换行</strong>，只需把规则<strong>插入默认的 { } 中间</strong>即可。</li>
</ul>
<pre class="notranslate" style="white-space: pre-wrap;user-select: auto;">
// 下面示例是把所有规则都塞进去了，但实际上大部分都用不上，大多数网站只需要像第一个 "aaa" 这样的规则（下方 示例一 中 url、replaceE、scrollD 均可按需省略）：

// "aaa"       是规则名，唯一，因为 自定义翻页规则 优先级最高，所以会覆盖同名的 外置翻页规则
// "host"      是域名，支持正则表达式（如 示例四），也可以像这样 示例三 那样写多个域名或正则表达式（当然也可以混用），如果省略，则默认匹配所有域名（会对所有域名匹配 url 规则判断，可以当成一个简单的外置/自定义通用规则的方案）
// "url"       是用来控制哪些网站中页面适用该规则，省略后代表该规则应用于全站（如果不知道写什么，那么就写 return fun.isPager() 这样脚本会默认自动匹配当前网站下存在 nextL 及 pageE 元素的网页，大部分网站是没问题的，如果改为匹配 replaceE 或者其他组合，那么请去上面的 Github Issues 里的 内置函数 中查看具体使用方法；另外，url 规则中可通过操作 rule 这个对象变量来修改当前网页实际应用的规则，如 rule.pager.pageE='#a' 具体示例也见 Github Issues 里）

// "nextL"     是用来指定含有下一页地址的元素选择器（CSS 或 XPath 都行，一般都是 &lt;a&gt; 元素）
// "pageE"     是指定要从下一页获取的元素选择器（也就是网页主体内容），并将其插入当前网页中同样元素的末尾
// "replaceE"  用于将当前网页中的页码元素替换为下一页的页码元素选择器（这样才能无限翻页下去），省略后将会自动判断是替换 nextL 元素自身还是 nextL 元素的父元素（当 nextL 元素后面或前面有其自身 &lt;a&gt; 元素的相邻兄弟元素时脚本会替换其父元素，反之没有相邻兄弟元素则替换其自身，仅限模式1/3/6，且 "js;" 开头的 nextL 规则除外），值为空 "" 时则完全不替换
// "scrollD"   是用来指定触发翻页的滚动条与底部之间的距离，当滚动条底部距离网页底部之间的距离等于或小于该值时，将触发翻页，因此值越大就越早触发翻页，访问速度慢的网站需要调大，可省略(记得移除上一行末尾逗号)，省略后默认 2000

// "inherits"  是继承标识，当你只需要对某个外置规则中 增删改 部分规则内容时（比如只是修改域名），那么就可以像下面第二个 "aaa" 规则一样写一个同名规则，规则内只需要有要修改的 host 内容，以及 inherits 标识，这样脚本就会将这个自定义翻页规则中的 host 覆盖掉外置翻页规则中的 host，而该翻页规则内的其他规则内容则不变。即更灵活了，无需每次为了修改部分规则而去复制全部规则了，也不用担心我后续更新这个外置规则后，你还需要再次复制一遍来修改。。。

{
    "aaa": {
        "host": "aaaa",
        "url": "return fun.isPager()",
        "pager": {
            "nextL": "xxxx",
            "pageE": "xxxx",
            "replaceE": "xxxx",
            "scrollD": 2000
        }
    },
    "aaa": {
        "host": "cccc",
        "inherits": true
    },
    "bbb": {
        "host": ["bbb1.com", "bbb2.com"],
        "url": "/^\\\\/s$/",
        "style": ".aaaa {xxx: xxx}（如果只是为了单纯屏蔽隐藏某些元素，那么这里只需要写 CSS 选择器即可，脚本会自动在末尾加上 {display: none !important;} 的）",
        "blank": 3,
        "hiddenPN": true,
        "history": false,
        "thread": true,
        "iframe": true,
        "pager": {
            "type": 1,
            "nextL": "id('page')//a[contains(text(),'下一页')] || id('page2')//a[text()='下一页']",
            "pageE": "aaa",
            "insertP": [".bbb",3],
            "replaceE": ".page",
            "scriptT": 1,
            "forceHTTPS": true,
            "interval": 500,
            "scrollD": 2000
        },
        "function": {
            "bF": "return fun.src_bF(pageE, [0,'img[data-src]','data-src'])",
            "bFp": "关于上面这个解决图片懒加载的 bF，如果你要选择的图片是 img[data-original] 或 img[data-src]，那么是可以直接省略为：return fun.src_bF(pageE)",
            "aF": "document.body.appendChild(document.createElement('script')).textContent = 'xxx'"
        }
    },
    "这里也可以用中文": {
        "host": "/\\\\.ccc\\\\.com/",
        "url": "fun.isUrlC(); return (fun.lp() == '/' || fun.indexOF('/s') || fun.isMobile())",
        "pager": {
            "type": 2,
            "nextL": "#autopbn",
            "nextText": "下一页",
            "nextTextOf": "下一页",
            "isHidden": true,
            "interval": 1000,
            "scrollD": 2000
        }
    }
}
</pre></details>
<details><summary style="cursor: pointer;overflow: hidden;text-overflow: ellipsis;white-space: nowrap;"><kbd><strong>「 点击展开 查看所有规则 」（可按 Ctrl+F 搜索规则，脚本内置的通用规则因格式限制无法列出）</strong></kbd></summary>
<pre id="Autopage_customRules_all" class="notranslate" style="overflow-y: scroll; overflow-x: hidden; height: 500px; word-break: break-all; white-space: pre-wrap;user-select: auto;"> </pre></details>

<textarea id="Autopage_customRules_textarea" style="min-width:95%; min-height:70%; display: block; margin: 10px 0 10px 0; white-space:pre; overflow:scroll; resize: revert; text-transform: initial;" placeholder="留空等于默认的 {}，请把规则插入 {} 之间"></textarea>
<button id="Autopage_customRules_save" style="margin-right: 20px;">保存并刷新</button><button id="Autopage_customRules_cancel">取消修改</button>
</div>`
        document.documentElement.insertAdjacentHTML('beforeend', `<div id="Autopage_customRules" style="display: initial !important;position: fixed !important;z-index: 9999999 !important;"></div>`);
        let Autopage_customRules = getCSS('#Autopage_customRules'), shadowRoot = Autopage_customRules.attachShadow({ mode: 'open' }); // 创建一个 Shadow DOM 避免网页样式影响自定义翻页规则元素
        shadowRoot.innerHTML = _html; // 插入元素
        document.documentElement.style.overflow = document.body.style.overflow = 'hidden'; // 避免网页本身滚动
        getCSS('#Autopage_customRules_textarea', shadowRoot).textContent = customRules; // 单独插入自定义规则，避免被 insertAdjacentHTML 语义化 HTML 标签
        getCSS('#Autopage_customRules_all', shadowRoot).textContent = customStringify(DBSite2); // 单独插入全部规则列表，避免被 insertAdjacentHTML 语义化 HTML 标签
        // 点击事件
        getCSS('#Autopage_customRules_save', shadowRoot).onclick = function () {
            let customRules_textarea = getCSS('#Autopage_customRules_textarea', shadowRoot)
            customRules = customRules_textarea.value;
            if (!customRules) customRules = '{}'
            try {
                customRules = JSON.parse(customRules)
                GM_setValue('menu_customRules', customRules)
                location.reload();
            } catch (e) {
                let match = e.message.match(/at position (\d+)/),position;
                if (match) {
                    position = parseInt(match[1]);
                } else {
                    match = e.message.match(/line (\d+) column (\d+)/i);
                    position = calculatePositionFromLineColumn(customRules,match[1],match[2])
                }
                console.error('自定义规则存在格式错误：\n' + e.message + '\n错误位置为该区域中间：\n------\n' + customRules.slice((position<30)?0:position-30,position+29) + '\n------\n\n常见格式错误：\n1. 逗号：每组 { } 中的最后一个值末尾不能加逗号\n2. 转义：如果正则表达式中含有转义符 \\ 那就要对其再次转义为 \\\\\n3. 引号：规则中冒号左右的内容都需要加上双引号，如果内容中含有双引号则需要对双引号转义（即 \\" 这样），或改为单引号')
                window.alert('自定义规则存在格式错误：\n' + e.message + '\n错误位置为该区域中间：\n------\n' + customRules.slice((position<30)?0:position-30,position+29) + '\n------\n点击【确定】后脚本会为你定位并选中编辑框中格式错误的文本（部分格式错误定位可能不太精确，但错误一定是在选中文本的附近，如果是选中了行首的空格，则说明格式错误来自上一行末尾逗号）\n\n常见格式错误：\n1. 逗号：每组 { } 中的最后一个值末尾不能加逗号\n2. 转义：如果正则表达式中含有转义符 \\ 那就要对其再次转义为 \\\\\n3. 引号：规则中冒号左右的内容都需要加上双引号，如果内容中含有双引号则需要对双引号转义（即 \\" 这样），或改为单引号');
                customRules_textarea.selectionStart = position-1; // 选中开始位置
                customRules_textarea.selectionEnd = position; // 选中结束位置
                customRules_textarea.focus(); // 将焦点移动到 customRules_textarea
            }
        }
        getCSS('#Autopage_customRules_cancel', shadowRoot).onclick = function () {document.documentElement.style.overflow = document.body.style.overflow = ''; getCSS('#Autopage_customRules').remove();}
    }

    // 根据行号和列号计算字符串中的 position 位置
    function calculatePositionFromLineColumn(text, line, column) {
        if (!text || line < 1 || column < 1) {
            return -1;
        }

        const lines = text.split('\n');

        if (line > lines.length) {
            return -1;
        }

        let position = 0;

        for (let i = 0; i < line - 1; i++) {
            position += lines[i].length + 1; // +1 表示换行符
        }

        const currentLine = lines[line - 1];
        const columnPosition = Math.min(column - 1, currentLine.length);

        return position + columnPosition;
    }

    // 自定义的 stringify 函数，将 [ ] 内的元素从默认的 换行显示 格式化为 一行显示，用于显示自定义翻页规则等给用户看的场景
    function customStringify(obj) {
        return JSON.stringify(obj, null, 4)
            .replace(/(: \[)([\s\S]*?)(\],?\n)/g, (match, p1, p2, p3) => {
            return p1 + p2.replace(/\n/g, '').replace(/\s{4}/g, '') + p3;
        });
    }

    // 显示页码
    function pageNumber(type) {
        if (curSite.SiteTypeID === 0 || curSite.hiddenPN || (curSite.pager && curSite.pager.type == 5 && self != top)) {if (getCSS('#Autopage_number') && getCSS('#Autopage_number').shadowRoot) {getCSS('#Autopage_number_button', getCSS('#Autopage_number').shadowRoot).style.display = 'none';}; return}
        let status
        if (getCSS('#Autopage_number') && getCSS('#Autopage_number').shadowRoot) {status = getCSS('#Autopage_number_button', getCSS('#Autopage_number').shadowRoot);}
        switch (type) {
            case 'add':
                add(); break;
            case 'del':
                del(); break;
            case 'set':
                set(); break;
        }

        function add(){
            if (status) {
                if (status.style.display === 'none') {status.style.display = 'flex';}
                return
            }
            // 插入网页
            let _style = `<style>#Autopage_number_button {top: calc(75vh);left: 0;width: 32px;height: 32px;padding: 6px;display: flex;position: fixed;opacity: 0.3;transition: .2s;z-index: 9999998;cursor: pointer;user-select: none;flex-direction: column;align-items: center;justify-content: center;box-sizing: content-box;border-radius: 0 50% 50% 0;transform-origin: center;transform: translateX(-8px);background-color: #eee;-webkit-tap-highlight-color: transparent;box-shadow: 1px 1px 3px 0px #aaa;color: #000;font-size: medium;font-family: system-ui;} @media (any-hover: none) {#Autopage_number_button:active {opacity: 0.8;transform: translateX(0);}}@media (any-hover: hover) {#Autopage_number_button:hover {opacity: 0.8;transform: translateX(0);}}</style>`,
                _html = `<div id="Autopage_number_button" title="1. 此为【当前页码】（仅指脚本翻了多少页，并非实际页码，该页码可在脚本菜单中关闭）&#10;&#10;2. 鼠标【左键】点击此处可【临时暂停翻页】（再次点击可恢复）&#10;&#10;3. 鼠标【右键】点击此处可【回到顶部】">${pageNum._now}</div>`

            document.documentElement.insertAdjacentHTML('beforeend', `<div id="Autopage_number" style="display: flex !important;position: fixed !important;z-index: 9999998 !important;"></div>`);
            let Autopage_number = getCSS('#Autopage_number'), shadowRoot = Autopage_number.attachShadow({ mode: 'open' }); // 创建一个 Shadow DOM 避免网页样式影响页码元素
            shadowRoot.innerHTML = _style + _html; // 插入元素

            if (curSite.pager && curSite.pager.type == 5) window.top.document.xiu_pausePage = pausePage
            status = getCSS('#Autopage_number_button', shadowRoot);
            // 左键点击事件（临时暂停翻页）
            status.onclick = function(e) {
                if (pausePage) {this.style.color = '#FF5722'; this.style.fontStyle = 'italic';} else {this.style = '';}
                pausePage = !pausePage;
                if (curSite.pager && curSite.pager.type == 5) window.top.document.xiu_pausePage = pausePage
                e.preventDefault();
                e.stopPropagation();
                return false
            };
            // 右键点击事件（回到顶部）
            status.oncontextmenu = function(e) {
                window.scrollTo(0,0);
                e.preventDefault();
                e.stopPropagation();
                return false
            };
            set();
        }
        // 监听储存当前页码的对象值的变化
        function set(){
            Object.defineProperty(pageNum, 'now', {
                set: function(value) {
                    this._now = value;
                    if (status) status.textContent = value;
                }
            });
        }
        function del(){
            if (!status) return
            status.style.display = 'none';
        }
    }

    // 页码递增，省略参数默认 +1
    function pageNumIncrement(num = 1) {
        pageNum.now = pageNum._now + num
    }

    // 菜单开关
    function menu_switch(menu_status, Name, Tips) {
        if (menu_status === true){
            GM_setValue(Name, false);
        } else {
            GM_setValue(Name, true);
        }
        if (Name === 'menu_page_number') {
            if (menu_status === true){pageNumber('del');} else {pageNumber('add');}
            registerMenuCommand(); // 重新注册脚本菜单
            if (curSite.SiteTypeID !== 0 && curSite.pager) { // 解决开关页码后 翻页失效的问题
                if (curSite.pager.type === undefined) curSite.pager.type = 1; // 默认翻页模式 1
                if (curSite.pager.scrollD === undefined) curSite.pager.scrollD = 2000; // 默认翻页触发线 2000
                if (curSite.pager.interval === undefined) curSite.pager.interval = 500; // 默认间隔时间 500ms
            }
        } else {
            location.reload();}
    };
    // 生成 SiteTypeID
    function setSiteTypeID() {
        let num = 0
        for (let val in DBSite) {
            DBSite[val].SiteTypeID = ++num;
        }
    }
    // 获取 Cookie
    function getCookie(name) {
        if (!name) return ''
        let arr = document.cookie.split(';');
        name += '='
        for (let i=0; i<arr.length; i++) {
            let now = arr[i].trim();
            if (now.indexOf(name) == 0) return now.substring(name.length, now.length);
        }
        return '';
    }
    // 插入位置
    function getAddTo(num) {
        switch (num) {
            case 1:
                return 'beforebegin'; break;
            case 2:
                return 'afterbegin'; break;
            case 3:
            case 6:
                return 'beforeend'; break;
            case 4:
            case 5:
                return 'afterend'; break;
        }
    }
    // 插入位置 5 时，排除 <script> <style> <link> 标签
    function toE5pop(a) {
        if (a.length === 0) return
        let b = a.pop();
        if (b.tagName === 'SCRIPT' || b.tagName === 'STYLE' || b.tagName === 'LINK') {
            return toE5pop(a);
        }
        return b
    }
    // 滚动条事件
    function windowScroll(fn1) {
        var beforeScrollTop = document.documentElement.scrollTop || document.body.scrollTop,
            fn = fn1 || function () {};
        setTimeout(function () { // 延时 1 秒执行，避免刚载入到页面就触发翻页事件

            // 避免网页内容太少，高度撑不起来，不显示滚动条而无法触发翻页事件
            let scrollTop = document.documentElement.scrollTop || window.pageYOffset || document.body.scrollTop,
                scrollHeight = window.innerHeight || document.documentElement.clientHeight
            if (scrollTop === 0 && document.documentElement.scrollHeight === scrollHeight) {
                insStyle(`html, body {min-height: ${document.documentElement.scrollHeight+10}px;}`)
            }

            window.addEventListener('scroll', function (e) {
                var afterScrollTop = document.documentElement.scrollTop || document.body.scrollTop,
                    delta = afterScrollTop - beforeScrollTop;
                if (delta == 0) return false;
                fn(delta > 0 ? 'down' : 'up', e);
                beforeScrollTop = afterScrollTop;
            }, false);
        }, 1000)
    }
    // 自定义 urlchange 事件（用来监听 URL 变化）
    function addUrlChangeEvent() {
        history.pushState = ( f => function pushState(){
            var ret = f.apply(this, arguments);
            window.dispatchEvent(new Event('pushstate'));
            window.dispatchEvent(new Event('urlchange'));
            return ret;
        })(history.pushState);

        history.replaceState = ( f => function replaceState(){
            var ret = f.apply(this, arguments);
            window.dispatchEvent(new Event('replacestate'));
            window.dispatchEvent(new Event('urlchange'));
            return ret;
        })(history.replaceState);

        window.addEventListener('popstate',()=>{
            window.dispatchEvent(new Event('urlchange'))
        });
    }
})();
