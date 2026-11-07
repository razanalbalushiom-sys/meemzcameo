/* =========================================================
   Meemz Cameo — storefront script (shared by all store pages)
   Arabic is the default language; English is available via the
   language switch. Static text uses <span class="ar|en">, dynamic
   text uses T('arabic','english').
   ========================================================= */
const API_BASE = '/api';
const STORAGE = {
  lang: 'meemzLang',
  draft: 'meemzCheckoutDraft',
  orders: 'meemzCustomerOrders',
  cart: 'meemzCart'
};

// ========================= LANGUAGE =========================
function storageGet(key, fallback=null){
  try{ const v=localStorage.getItem(key); return v===null?fallback:v; }catch(e){ return fallback; }
}
function storageSet(key, value){
  try{ localStorage.setItem(key, value); }catch(e){}
}
function storageRemove(key){
  try{ localStorage.removeItem(key); }catch(e){}
}
let lang = storageGet(STORAGE.lang,'ar')==='en' ? 'en' : 'ar';
function T(ar, en){ return lang==='en' ? (en ?? ar) : ar; }
function L(obj, key){
  if(!obj)return '';
  const en=obj[key+'En'];
  return lang==='en' && en ? en : (obj[key] || en || '');
}
function applyLangToDocument(){
  document.documentElement.lang=lang;
  document.documentElement.dir=lang==='en'?'ltr':'rtl';
  document.querySelectorAll('[data-ph-ar]').forEach(el=>{
    el.placeholder=lang==='en' ? (el.dataset.phEn||el.dataset.phAr) : el.dataset.phAr;
  });
}
function setLang(next){
  lang=next==='en'?'en':'ar';
  storageSet(STORAGE.lang,lang);
  applyLangToDocument();
  renderAll();
  rerenderOpenCheckout();
}
function toggleLang(){ setLang(lang==='en'?'ar':'en'); }

// ========================= STATE =========================
let products = [];
let productsLoaded = false;
let cart = readCart();
let activeFilter = 'all';
let productSearch = '';
let productSort = 'default';
let checkoutDraft = readCheckoutDraft();
let activeProductDetailsId = null;
let activeProductImageIndex = 0;
let activeProductColor = '';
let activeProductQty = 1;
let productSwipeStartX = 0;
let appliedCoupon = null;
let uploadedProof = null;
let checkoutReview = null;
let orderSubmitting = false;
let checkoutSubmissionKey = '';
let selectedReviewRating = 5;
let deliveryChoice = 'with';
let orderStep = 0;

const DEFAULT_WHATSAPP = '+96879960608';
const DEFAULT_INSTAGRAM = 'https://instagram.com/meemz.cameo';

let settings = {
  siteName: 'ميمز كاميو',
  siteNameEn: 'Meemz Cameo',
  siteDescription: "صُنعت لكم بعناية وحب — توزيعات وتفعيلات مدرسية ومناسبات في سلطنة عُمان.",
  siteDescriptionEn: "Made for you with care and love — school and occasion favours and activities in Oman.",
  heroTitle: "توزيعات مدرسية ومناسبات، صُنعت لكم بعناية وحب",
  heroTitleEn: "School & occasion favours, made for you with care and love",
  heroSubtitle: "بوكسات توزيعات بثيم مناسبتك، تفعيلات الحروف، أنشطة وتلوين، مشاريع مدرسية وقصاصات ورقية — نجهزها بالعدد الذي تحتاجينه ونوصلها لجميع أنحاء السلطنة.",
  heroSubtitleEn: "Favour boxes in your occasion's theme, letter activities, activity and colouring boxes, school projects and paper cutouts — prepared in the quantity you need and delivered anywhere in Oman.",
  tickerItems: [],
  seoTitle: "ميمز كاميو — توزيعات وتفعيلات مدرسية ومناسبات",
  seoDescription: "ميمز كاميو: بوكسات توزيعات للمناسبات المدرسية والوطنية، تفعيلات الحروف، مشاريع مدرسية وقصاصات ورقية — صُنعت لكم بعناية وحب، مع توصيل لجميع أنحاء السلطنة.",
  seoImage: '',
  deliveryCost: 2.000,
  vatRate: 0,
  waNumber: DEFAULT_WHATSAPP,
  instagramUrl: DEFAULT_INSTAGRAM,
  tiktokUrl: '',
  paymentPhone: '',
  bankName: '',
  bankAccount: '',
  categories: [{"id": "occasion-boxes", "icon": "gift", "name": "بوكسات توزيعات المناسبات", "nameEn": "Occasion favour boxes", "active": true}, {"id": "activity-boxes", "icon": "pen", "name": "بوكسات الأنشطة والتلوين", "nameEn": "Activity & colouring boxes", "active": true}, {"id": "letter-activities", "icon": "sparkle", "name": "تفعيلات الحروف", "nameEn": "Letter activities", "active": true}, {"id": "school-projects", "icon": "frame", "name": "مشاريع مدرسية", "nameEn": "School projects", "active": true}, {"id": "paper-cutouts", "icon": "scissors", "name": "قصاصات الورق", "nameEn": "Paper cutouts", "active": true}, {"id": "birthdays", "icon": "ribbon", "name": "توزيعات أعياد الميلاد", "nameEn": "Birthday favours", "active": true}],
  services: [{"icon": "sparkle", "title": "تصميم بثيم مناسبتك", "titleEn": "Designed for your occasion", "desc": "نصمم التوزيعات بشعار المدرسة واسم المناسبة وألوانها — مهرجان العلوم، يوم الزراعة، يوم المرأة وغيرها.", "descEn": "We design favours with your school logo, occasion name and colours — science festival, Agriculture Day, Women's Day and more.", "message": "مرحباً ميمز كاميو، أريد توزيعات بثيم مناسبة خاصة:"}, {"icon": "box", "title": "تجهيز الطلبات بالكميات", "titleEn": "Bulk order preparation", "desc": "نجهز البوكسات لصف كامل أو مدرسة كاملة، مغلفة وجاهزة للتوزيع.", "descEn": "We prepare boxes for a whole class or school, packed and ready to hand out.", "message": "مرحباً ميمز كاميو، أريد طلب توزيعات بكمية كبيرة."}, {"icon": "scissors", "title": "تفعيلات وقصاصات حسب الطلب", "titleEn": "Activities & cutouts on request", "desc": "تفعيلات الحروف، المشاريع المدرسية والقصاصات الورقية مقصوصة وجاهزة للاستخدام.", "descEn": "Letter activities, school projects and paper cutouts, cut and ready to use.", "message": "مرحباً ميمز كاميو، أريد تفعيل حرف / مشروع مدرسي:"}],
  ads: [],
  coupons: []
};

const STATUS_LABELS = {
  new:['جديد','New'],
  payment_confirmed:['تم تأكيد التحويل','Payment confirmed'],
  processing:['قيد التجهيز','Being prepared'],
  ready_for_final_delivery:['جاهز للتسليم','Ready for delivery'],
  out_for_delivery:['خرج للتوصيل','Out for delivery'],
  shipped:['تم الشحن','Shipped'],
  delivered:['تم التسليم','Delivered'],
  done:['مكتمل','Completed'],
  cancelled:['ملغي','Cancelled']
};
const WILAYATS = [
  ['مسقط','Muscat'],['ظفار','Dhofar'],['شمال الباطنة','North Al Batinah'],['جنوب الباطنة','South Al Batinah'],
  ['شمال الشرقية','North Al Sharqiyah'],['جنوب الشرقية','South Al Sharqiyah'],['الداخلية','Al Dakhiliyah'],
  ['الظاهرة','Al Dhahirah'],['الوسطى','Al Wusta'],['البريمي','Al Buraimi'],['مسندم','Musandam']
];

// ========================= HELPERS =========================
function id(x){ return document.getElementById(x); }
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function omr(n){
  const value=Number(n);
  return (Number.isFinite(value)?value:0).toFixed(3)+' '+T('ر.ع','OMR');
}
function num(n){ return Number(n||0).toLocaleString('en-US'); }
function readJson(key, fallback){
  try{
    const parsed=JSON.parse(storageGet(key,'') || 'null');
    return parsed ?? fallback;
  }catch(e){ storageRemove(key); return fallback; }
}
function readCheckoutDraft(){
  const d=readJson(STORAGE.draft,{});
  return d && typeof d==='object' && !Array.isArray(d) ? d : {};
}
function readCart(){
  const c=readJson(STORAGE.cart,[]);
  return Array.isArray(c) ? c.filter(i=>i && i.id && Number(i.qty)>0) : [];
}
function saveCart(){ storageSet(STORAGE.cart, JSON.stringify(cart.map(i=>({id:i.id,qty:i.qty,selectedColor:i.selectedColor||''})))); }
function cleanPhone(phone){
  const digits=String(phone||'').replace(/\D/g,'');
  if(digits.startsWith('968'))return digits;
  if(digits.length===8)return '968'+digits;
  return digits || cleanPhone(DEFAULT_WHATSAPP);
}
function whatsappUrl(phone,text=''){
  const cleaned=cleanPhone(phone||settings.waNumber);
  return `https://wa.me/${cleaned}${text?`?text=${encodeURIComponent(text)}`:''}`;
}
function omanLocalPhone(phone){
  const digits=String(phone||'').replace(/\D/g,'');
  if(digits.startsWith('968'))return digits.slice(3,11);
  return digits.slice(0,8);
}
function normalizeOmanPhoneField(input){ if(input)input.value=omanLocalPhone(input.value); }
function prettyPhone(phone){
  const local=omanLocalPhone(phone);
  return local.length===8 ? `+968 ${local.slice(0,4)} ${local.slice(4)}` : String(phone||'');
}
function calcVat(amount){ return amount * (Number(settings.vatRate||0) / 100); }
function couponDiscount(base){
  if(!appliedCoupon)return 0;
  const subtotal=Number(base||0);
  const value=Number(appliedCoupon.value||0);
  if(String(appliedCoupon.type||'percent')==='amount')return Math.min(subtotal, Math.max(0,value));
  return Math.min(subtotal, Math.max(0, subtotal * value / 100));
}
function calcOrderTotals(base, delivery){
  const discount=couponDiscount(base);
  const discountedBase=Math.max(0,Number(base||0)-discount);
  const taxable=discountedBase+Number(delivery||0);
  const vat=calcVat(taxable);
  return {base:Number(base||0), discount, delivery:Number(delivery||0), vat, grand:taxable+vat};
}
function cartSubtotal(){ return cart.reduce((s,i)=>s+Number(i.price||0)*i.qty,0); }
function currentDeliveryCost(){ return deliveryChoice==='with' ? Number(settings.deliveryCost||0) : 0; }
let toastTimer=null;
function showToast(msg, icon='✓'){
  id('toastIcon').textContent=icon;
  id('toastMsg').textContent=msg;
  const t=id('toast'); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),3200);
}
function createCheckoutSubmissionKey(){
  if(window.crypto?.randomUUID)return window.crypto.randomUUID();
  return 'checkout-'+Date.now()+'-'+Math.random().toString(16).slice(2);
}
function iconSvg(name, cls='svg-icon'){
  const safe=String(name||'gift').replace(/[^a-z0-9-]/gi,'') || 'gift';
  return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${safe}"></use></svg>`;
}
const ICON_MAP={
  '🎁':'gift','📚':'frame','✏️':'pen','🍫':'box','🌱':'flower','🧪':'sparkle','🌸':'flower','🌷':'flower','🌹':'flower','💐':'flower','🖼️':'frame','💌':'card','✉️':'card','🎀':'ribbon','✂️':'scissors',
  '❤️':'heart','💖':'heart','✨':'sparkle','🖊️':'pen','✍️':'pen','📦':'box','🚚':'truck','🛍️':'bag',
  gift:'gift','gift-boxes':'gift',boxes:'gift',flower:'flower',flowers:'flower','paper-flowers':'flower',
  frame:'frame',frames:'frame','paper-art':'frame',art:'frame',card:'card',cards:'card',ribbon:'ribbon',occasions:'ribbon',
  scissors:'scissors',custom:'scissors','occasion-boxes':'gift','activity-boxes':'pen','letter-activities':'sparkle','school-projects':'frame','paper-cutouts':'scissors',birthdays:'ribbon',heart:'heart',sparkle:'sparkle',pen:'pen',box:'box',truck:'truck',bag:'bag'
};
function iconName(value){
  const raw=String(value||'').trim();
  return ICON_MAP[raw] || ICON_MAP[raw.toLowerCase()] || 'gift';
}
function iconFor(value, cls='svg-icon'){ return iconSvg(iconName(value), cls); }
function parseJsonList(value, fallback){
  if(Array.isArray(value))return value;
  if(!value)return fallback;
  try{ const parsed=JSON.parse(value); return Array.isArray(parsed)?parsed:fallback; }catch(e){ return fallback; }
}
function statusText(status,label){
  const pair=STATUS_LABELS[status];
  return pair ? T(pair[0],pair[1]) : (label||status||'');
}

// ========================= SETTINGS =========================
function categorySlug(value){
  return String(value||'').trim().toLowerCase().replace(/\s+/g,'-').replace(/[^\w؀-ۿ-]/g,'').slice(0,40);
}
function normalizedCategories(includeHidden=false){
  const items=(Array.isArray(settings.categories)?settings.categories:[])
    .map(c=>({
      id: categorySlug(c.id || c.name),
      icon: String(c.icon || c.id || 'gift').trim(),
      name: String(c.name || '').trim(),
      nameEn: String(c.nameEn || '').trim(),
      active: c.active !== false && c.active !== 'false'
    }))
    .filter(c=>c.id && c.name);
  return includeHidden ? items : items.filter(c=>c.active);
}
function catLabel(catId){
  const c=normalizedCategories(true).find(x=>x.id===catId);
  return c ? L(c,'name') : (catId||'');
}
function normalizedServices(){
  return (Array.isArray(settings.services)?settings.services:[]).map(s=>({
    icon:String(s.icon||'gift').trim(), title:String(s.title||'').trim(), titleEn:String(s.titleEn||'').trim(),
    desc:String(s.desc||'').trim(), descEn:String(s.descEn||'').trim(),
    message:String(s.message||s.title||'').trim(), image:String(s.image||'').trim()
  })).filter(s=>s.title);
}
function normalizedAds(){
  return (Array.isArray(settings.ads)?settings.ads:[]).map(ad=>({
    title:String(ad.title||'').trim(), titleEn:String(ad.titleEn||'').trim(),
    image:String(ad.image||'').trim(), url:String(ad.url||'').trim()
  })).filter(ad=>ad.image);
}
function normalizedCoupons(){
  return (Array.isArray(settings.coupons)?settings.coupons:[]).map(c=>({
    code:String(c.code||'').trim().toUpperCase(), type:String(c.type||'percent').trim(),
    value:Number(c.value||0), active:c.active !== false && c.active !== 'false'
  })).filter(c=>c.code && c.value>0);
}
function normalizeTickerItems(value){
  let items=value;
  if(typeof items==='string'){ try{ const p=JSON.parse(items); items=Array.isArray(p)?p:items; }catch(e){} }
  if(typeof items==='string')items=items.split(/\r?\n|\|/);
  if(!Array.isArray(items))return [];
  return items.map(i=>String(i||'').trim()).filter(Boolean).slice(0,8);
}
function settingValue(source,key,fallback=''){
  return Object.prototype.hasOwnProperty.call(source||{},key) && source[key]!=='' && source[key]!=null ? source[key] : fallback;
}
function settingNumber(source,key,fallback=0){
  const raw=settingValue(source,key,undefined);
  if(raw===undefined)return fallback;
  const value=parseFloat(raw);
  return Number.isFinite(value)?value:fallback;
}
function setMeta(name, content, attr='name'){
  if(!content)return;
  let el=document.querySelector(`meta[${attr}="${name}"]`);
  if(!el){el=document.createElement('meta');el.setAttribute(attr,name);document.head.appendChild(el);}
  el.setAttribute('content',content);
}
function loadSettings(){
  return fetch(API_BASE+'/settings',{credentials:'include'})
    .then(r=>r.json())
    .then(j=>{
      const raw=j.settings||j.rows||{};
      const s=Array.isArray(raw) ? Object.fromEntries(raw.map(r=>[r.key,r.value])) : raw;
      ['siteName','siteNameEn','siteDescription','siteDescriptionEn','heroTitle','heroTitleEn','heroSubtitle','heroSubtitleEn',
       'seoTitle','seoDescription','seoImage','waNumber','instagramUrl','tiktokUrl','paymentPhone','bankName','bankAccount']
        .forEach(k=>{ settings[k]=settingValue(s,k,settings[k]); });
      settings.tickerItems=normalizeTickerItems(settingValue(s,'tickerItems',settings.tickerItems));
      settings.categories=parseJsonList(s.categories, settings.categories);
      settings.services=parseJsonList(s.services, settings.services);
      settings.ads=parseJsonList(s.ads, settings.ads);
      settings.coupons=parseJsonList(s.coupons, settings.coupons);
      settings.deliveryCost=settingNumber(s,'deliveryCost',settings.deliveryCost);
      settings.vatRate=settingNumber(s,'vatRate',settings.vatRate);
    })
    .catch(e=>console.warn('Settings API failed', e))
    .finally(()=>renderAll());
}

// ========================= RENDER: CHROME =========================
function heroTitleHtml(title){
  // highlight the part after the first comma / Arabic comma in rose
  const text=String(title||'');
  const m=text.match(/^(.*?[,،])\s*(.+)$/);
  return m ? `${esc(m[1])} <em>${esc(m[2])}</em>` : esc(text);
}
function applySettings(){
  const siteName=L(settings,'siteName');
  if(id('heroTitle')) id('heroTitle').innerHTML=heroTitleHtml(L(settings,'heroTitle'));
  if(id('heroSubtitle')) id('heroSubtitle').textContent=L(settings,'heroSubtitle');
  if(id('footerDescription')) id('footerDescription').textContent=L(settings,'siteDescription');
  if(id('footerCopyright')) id('footerCopyright').textContent=`© ${new Date().getFullYear()} ${siteName}. ${T('جميع الحقوق محفوظة · سلطنة عُمان','All rights reserved · Sultanate of Oman')}`;
  const pageTitles={
    'shop-page':T('المتجر','Shop'),'about-page':T('قصتنا','Our story'),'my-orders-page':T('طلباتي','My orders')
  };
  const pageKey=Object.keys(pageTitles).find(k=>document.body.classList.contains(k));
  const baseTitle=lang==='en' ? `${siteName} — School & occasion favours` : (settings.seoTitle||siteName);
  if(!document.body.classList.contains('product-page')) document.title=pageKey ? `${pageTitles[pageKey]} · ${siteName}` : baseTitle;
  setMeta('description', settings.seoDescription || settings.siteDescription);
  setMeta('og:title', settings.seoTitle || siteName, 'property');
  setMeta('og:description', settings.seoDescription || settings.siteDescription, 'property');
  if(settings.seoImage) setMeta('og:image', settings.seoImage, 'property');
  const wa=whatsappUrl(settings.waNumber, T('مرحباً ميمز كاميو ✨','Hello Meemz Cameo ✨'));
  ['waCtaBtn','waFloat'].forEach(k=>{ if(id(k)) id(k).href=wa; });
  document.querySelectorAll('[data-wa-link]').forEach(a=>{ a.href=wa; });
  document.querySelectorAll('[data-wa-text]').forEach(el=>{ el.textContent=prettyPhone(settings.waNumber); });
  const insta=settings.instagramUrl||DEFAULT_INSTAGRAM;
  if(id('instaCtaBtn')) id('instaCtaBtn').href=insta;
  document.querySelectorAll('[data-insta-link]').forEach(a=>{ a.href=insta; });
  if(id('socialTikTok')){ id('socialTikTok').href=settings.tiktokUrl||'#'; id('socialTikTok').hidden=!settings.tiktokUrl; }
}
function renderTicker(){
  const bar=id('tickerBar'), inner=id('tickerInner');
  if(!bar||!inner)return;
  const items=normalizeTickerItems(settings.tickerItems);
  bar.hidden=!items.length;
  inner.innerHTML=items.length ? [...items,...items].map(i=>`<span>${iconSvg('sparkle')} ${esc(i)}</span>`).join('') : '';
}
function renderCategoryCards(){
  const wrap=id('categoryCards'); if(!wrap)return;
  const cats=normalizedCategories();
  wrap.innerHTML=cats.map(c=>{
    const count=products.filter(p=>p.isActive!==false && p.cat===c.id).length;
    return `<a class="category-card" href="/shop.html?cat=${encodeURIComponent(c.id)}">
      <span class="cat-icon">${iconFor(c.icon||c.id)}</span>
      <strong>${esc(L(c,'name'))}</strong>
      <small>${productsLoaded ? (count ? `${num(count)} ${T('منتج','items')}` : T('قريباً','Coming soon')) : '&nbsp;'}</small>
    </a>`;
  }).join('');
}
function renderCategoryButtons(){
  const wrap=id('categories'); if(!wrap)return;
  const cats=normalizedCategories();
  if(activeFilter!=='all' && !cats.some(c=>c.id===activeFilter))activeFilter='all';
  wrap.innerHTML=[
    `<button class="cat-btn ${activeFilter==='all'?'active':''}" type="button" onclick="filterProducts('all')">${iconSvg('bag')} ${T('الكل','All')}</button>`,
    ...cats.map(c=>`<button class="cat-btn ${activeFilter===c.id?'active':''}" type="button" onclick="filterProducts('${esc(c.id)}')">${iconFor(c.icon||c.id)} ${esc(L(c,'name'))}</button>`)
  ].join('');
}
function renderFooterCategories(){
  const wrap=id('footerCategories'); if(!wrap)return;
  wrap.innerHTML=normalizedCategories().slice(0,6).map(c=>`<a href="/shop.html?cat=${encodeURIComponent(c.id)}">${esc(L(c,'name'))}</a>`).join('');
}
function renderSortOptions(){
  const sel=id('productSort'); if(!sel)return;
  const opts=[['default',T('الترتيب الافتراضي','Featured')],['newest',T('الأحدث','Newest')],['priceAsc',T('السعر: من الأقل','Price: low to high')],['priceDesc',T('السعر: من الأعلى','Price: high to low')],['rating',T('الأعلى تقييماً','Top rated')]];
  sel.innerHTML=opts.map(([v,t])=>`<option value="${v}" ${productSort===v?'selected':''}>${esc(t)}</option>`).join('');
  sel.setAttribute('aria-label',T('ترتيب المنتجات','Sort products'));
}
function renderServices(){
  const grid=id('servicesGrid'); if(!grid)return;
  const items=normalizedServices();
  const section=id('services');
  if(section) section.hidden=!items.length;
  grid.innerHTML=items.map((s,i)=>`
    <button class="service-card" type="button" onclick="openServiceWhatsApp(${i})">
      ${s.image?`<div class="service-image"><img src="${esc(s.image)}" alt="" loading="lazy" onerror="this.closest('.service-image').remove()"/></div>`:`<div class="service-icon">${iconFor(s.icon)}</div>`}
      <div class="service-title">${esc(L(s,'title'))}</div>
      <div class="service-desc">${esc(L(s,'desc'))}</div>
      <div class="service-cta">${iconSvg('whatsapp')} ${T('اطلبيها عبر واتساب','Request on WhatsApp')}</div>
    </button>`).join('');
}
function openServiceWhatsApp(index){
  const s=normalizedServices()[index]; if(!s)return;
  window.open(whatsappUrl(settings.waNumber, s.message || `${T('مرحباً، أريد الاستفسار عن','Hello, I would like to ask about')} ${L(s,'title')}`),'_blank','noopener');
}
function openCustomOrder(){
  window.open(whatsappUrl(settings.waNumber, T('مرحباً ميمز كاميو ✨ أريد طلب توزيعات لمناسبة:\nالمناسبة / المدرسة: \nالعدد: \nالتاريخ المطلوب: ','Hello Meemz Cameo ✨ I would like favours for an occasion:\nOccasion / school: \nQuantity: \nDate needed: ')),'_blank','noopener');
}
function renderAds(){
  const section=id('adsSection'), grid=id('adsGrid');
  if(!section||!grid)return;
  const ads=normalizedAds();
  section.classList.toggle('visible', ads.length>0);
  grid.innerHTML=ads.map(ad=>{
    const title=L(ad,'title');
    const content=`<img src="${esc(ad.image)}" alt="${esc(title||settings.siteName)}" loading="lazy" onerror="this.closest('.ad-card').remove();renderAdsVisibilityFallback();">${title?`<div class="ad-card-title">${esc(title)}</div>`:''}`;
    return /^https?:\/\/|^\//.test(ad.url) ? `<a class="ad-card" href="${esc(ad.url)}" ${/^https?:/.test(ad.url)?'target="_blank" rel="noopener"':''}>${content}</a>` : `<div class="ad-card">${content}</div>`;
  }).join('');
}
function renderAdsVisibilityFallback(){
  const section=id('adsSection'), grid=id('adsGrid');
  if(section&&grid) section.classList.toggle('visible', grid.children.length>0);
}

// ========================= PRODUCTS =========================
function normalizeProductFromApi(p){
  const d=p.productDetails||{};
  return {
    ...p,
    cat: p.cat || p.category || '',
    emoji: p.emoji || '',
    oldPrice: p.oldPrice == null || p.oldPrice === '' ? null : Number(p.oldPrice),
    badgeType: p.badgeType || '',
    rating: Number(p.rating || 5),
    reviews: Number(p.reviews || 0),
    desc: p.desc || p.description || '',
    nameEn: p.nameEn || d.nameEn || '',
    descEn: p.descEn || d.descEn || '',
    specs: Array.isArray(p.specs) ? p.specs : (d.specs || []),
    boxContents: Array.isArray(p.boxContents) ? p.boxContents : (d.boxContents || []),
    colors: Array.isArray(p.colors) ? p.colors : (d.colors || []),
    deliveryTime: p.deliveryTime || d.deliveryTime || '',
    images: Array.isArray(p.images) ? p.images : [],
    isActive: p.isActive !== false && p.is_active !== false,
    stock: Number(p.stock || 0),
    price: Number(p.price || 0)
  };
}
function fetchProducts(){
  return fetch(API_BASE+'/products',{credentials:'include'})
    .then(r=>r.json())
    .then(j=>{
      const list=Array.isArray(j) ? j : (j.products || []);
      if(Array.isArray(list)) products=list.map(normalizeProductFromApi);
    })
    .catch(e=>console.warn('Products API failed', e))
    .finally(()=>{
      productsLoaded=true;
      syncCartWithProducts();
      renderProducts(); renderCategoryCards(); renderStandaloneProductPage(); updateCartUI();
    });
}
function productName(p){ return L(p,'name'); }
function productDesc(p){ return L(p,'desc'); }
function badgeText(p){
  const map={'جديد':['جديد','New'],'خصم':['خصم','Sale'],'ساخن':['الأكثر طلباً','Bestseller'],'الأكثر طلباً':['الأكثر طلباً','Bestseller']};
  const pair=map[p.badge];
  return pair ? T(pair[0],pair[1]) : p.badge;
}
function productImages(p){
  const images=Array.isArray(p.images) ? p.images.filter(Boolean) : [];
  const main=p.image || p.image_url || p.imageUrl || '';
  return [...new Set([main,...images].filter(Boolean))];
}
function imgFallback(el, category='gift'){
  const holder=el.parentElement; if(!holder)return;
  el.remove();
  holder.insertAdjacentHTML('beforeend', iconFor(category,'svg-icon product-vector-icon'));
}
function productMainVisual(p){
  const imgs=productImages(p);
  if(imgs.length) return `<img src="${esc(imgs[0])}" alt="${esc(productName(p))}" loading="lazy" onerror="imgFallback(this,'${esc(p.cat||'gift')}')">`;
  return iconFor(p.cat || p.emoji || 'gift','svg-icon product-vector-icon');
}
function starsHtml(rating){
  const r=Math.max(0,Math.min(5,Math.round(Number(rating||0))));
  return `<span class="stars" aria-label="${r}/5">${'★'.repeat(r)}${'☆'.repeat(5-r)}</span>`;
}
function stockLabel(p){
  const stock=Number(p.stock||0);
  if(stock<=0)return `<span class="stock-pill stock-out">${T('نفدت الكمية','Sold out')}</span>`;
  if(stock<=3)return `<span class="stock-pill">${T(`آخر ${stock} قطع`,`Only ${stock} left`)}</span>`;
  return `<span class="stock-pill">${T('متوفر','In stock')}</span>`;
}
function productCardHtml(p){
  const out=Number(p.stock||0)<=0;
  return `
    <article class="product-card" tabindex="0" onclick="openProductPage(${Number(p.id)})" onkeydown="if(event.key==='Enter')openProductPage(${Number(p.id)})">
      <div class="product-img">
        ${p.badge?`<span class="product-badge ${esc(p.badgeType)}">${esc(badgeText(p))}</span>`:''}
        ${productMainVisual(p)}
      </div>
      <div class="product-info">
        <div class="product-category">${esc(catLabel(p.cat))}</div>
        <h3 class="product-name">${esc(productName(p))}</h3>
        ${p.reviews>0?`<div class="product-rating">${starsHtml(p.rating)}<span>(${num(p.reviews)})</span></div>`:''}
        ${stockLabel(p)}
        <div class="product-footer">
          <div>
            ${p.oldPrice?`<span class="price-old">${omr(p.oldPrice)}</span>`:''}
            <span class="product-price">${omr(p.price)}</span>
          </div>
          <button class="add-btn" type="button" ${out?'disabled':''} onclick="event.stopPropagation();addToCart(${Number(p.id)})">${out?T('غير متوفر','Sold out'):T('أضيفي للسلة','Add to cart')}</button>
        </div>
      </div>
    </article>`;
}
function renderProducts(){
  const grid=id('productGrid'); if(!grid)return;
  const isHome=document.body.classList.contains('home-page');
  const query=productSearch.trim().toLowerCase();
  let list=products.filter(p=>p.isActive!==false);
  if(!isHome && activeFilter!=='all') list=list.filter(p=>p.cat===activeFilter);
  if(!isHome && query) list=list.filter(p=>[p.name,p.nameEn,p.desc,p.descEn,catLabel(p.cat)].join(' ').toLowerCase().includes(query));
  list=[...list].sort((a,b)=>{
    if(isHome) return Number(b.id||0)-Number(a.id||0);
    if(productSort==='priceAsc')return a.price-b.price;
    if(productSort==='priceDesc')return b.price-a.price;
    if(productSort==='rating')return (b.rating||0)-(a.rating||0);
    if(productSort==='newest')return Number(b.id||0)-Number(a.id||0);
    return 0;
  });
  if(isHome) list=list.slice(0,8);
  const tag=id('productsSectionTag'), title=id('productsSectionTitle');
  if(isHome){
    if(tag) tag.textContent=T('وصل حديثاً','New arrivals');
    if(title) title.textContent=T('أحدث البوكسات والتفعيلات','Latest boxes & activities');
  }else{
    if(tag) tag.textContent=activeFilter==='all' ? T('كل الفئات','All categories') : T('الفئة','Category');
    if(title) title.textContent=activeFilter==='all' ? T('كل المنتجات','All products') : catLabel(activeFilter);
  }
  if(id('productsCount')) id('productsCount').textContent=num(list.length);
  if(!productsLoaded){ grid.innerHTML=''; return; }
  if(!list.length){
    grid.innerHTML=`<div class="empty-state">${iconSvg('gift')}<div>${query ? T('لا توجد نتائج مطابقة لبحثك.','No results match your search.') : T('لا توجد بوكسات هنا بعد — اطلبيها بثيم مناسبتك عبر واتساب.','No boxes here yet — order one in your occasion\'s theme on WhatsApp.')}</div><button class="btn-ghost btn-sm" style="margin-top:14px" type="button" onclick="openCustomOrder()">${iconSvg('whatsapp')} ${T('اطلبي عبر واتساب','Order on WhatsApp')}</button></div>`;
    return;
  }
  grid.innerHTML=list.map(productCardHtml).join('');
}
function setProductSearch(value){ productSearch=value||''; renderProducts(); }
function setProductSort(value){ productSort=value||'default'; renderProducts(); }
function filterProducts(cat){
  activeFilter=cat||'all';
  renderCategoryButtons(); renderProducts();
  const url=new URL(location.href);
  if(activeFilter==='all') url.searchParams.delete('cat'); else url.searchParams.set('cat',activeFilter);
  history.replaceState(null,'',url);
}
function openProductPage(pid){ location.href='/product.html?id='+encodeURIComponent(pid); }

// ---------- product detail ----------
function currentDetailProduct(){ return products.find(x=>String(x.id)===String(activeProductDetailsId)); }
function changeProductImage(step){
  const p=currentDetailProduct(); if(!p)return;
  const imgs=productImages(p); if(!imgs.length)return;
  activeProductImageIndex=(activeProductImageIndex+step+imgs.length)%imgs.length;
  renderProductDetails();
}
function setProductImage(i){
  const p=currentDetailProduct(); if(!p)return;
  const imgs=productImages(p); if(!imgs.length)return;
  activeProductImageIndex=Math.max(0,Math.min(imgs.length-1,Number(i)||0));
  renderProductDetails();
}
function onProductSwipeStart(e){ productSwipeStartX=e.touches?.[0]?.clientX||0; }
function onProductSwipeEnd(e){
  const diff=(e.changedTouches?.[0]?.clientX||0)-productSwipeStartX;
  if(Math.abs(diff)>45) changeProductImage((diff>0)===(lang==='en')?-1:1);
}
function setDetailColor(index){
  const p=currentDetailProduct(); if(!p)return;
  activeProductColor=(p.colors||[])[Number(index)]||'';
  renderProductDetails();
}
function changeDetailQty(delta){
  const p=currentDetailProduct(); if(!p)return;
  const max=Math.max(1,Number(p.stock||1));
  activeProductQty=Math.max(1,Math.min(max,activeProductQty+delta));
  renderProductDetails();
}
function askProductWhatsApp(pid){
  const p=products.find(x=>String(x.id)===String(pid)); if(!p)return;
  const msg=T(`مرحباً ميمز كاميو، أريد الاستفسار عن: ${p.name} (${omr(p.price)})\nالمناسبة / المدرسة: \nالعدد: `,`Hello Meemz Cameo, I'd like to ask about: ${productName(p)} (${omr(p.price)})`);
  window.open(whatsappUrl(settings.waNumber,msg),'_blank','noopener');
}
function renderDetailList(title, items){
  if(!items || !items.length)return '';
  return `<div class="detail-meta-item" style="grid-column:1/-1;"><div class="detail-meta-label">${esc(title)}</div><ul class="detail-list">${items.map(v=>`<li>${esc(v)}</li>`).join('')}</ul></div>`;
}
function renderSpecTable(title, items){
  if(!items || !items.length)return '';
  return `<div class="detail-meta-item" style="grid-column:1/-1;"><div class="detail-meta-label">${esc(title)}</div><table class="detail-spec-table"><tbody>${items.map((v,i)=>{
    const parts=String(v).split(/[:：|]/);
    const label=parts.length>1 ? parts.shift().trim() : `#${i+1}`;
    return `<tr><td>${esc(label)}</td><td>${esc(parts.join(' - ').trim())}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function similarProductsHtml(p){
  const items=products.filter(x=>x.id!==p.id && x.cat===p.cat && x.isActive!==false).slice(0,4);
  if(!items.length)return '';
  return `<div class="detail-similar"><h3>${T('قد يعجبك أيضاً','You may also like')}</h3><div class="product-grid">${items.map(productCardHtml).join('')}</div></div>`;
}
function renderProductDetails(){
  const p=currentDetailProduct(); if(!p)return;
  const contentEl=id('standaloneProductContent'); if(!contentEl)return;
  const imgs=productImages(p);
  if(activeProductImageIndex>=imgs.length)activeProductImageIndex=0;
  const out=Number(p.stock||0)<=0;
  const name=productName(p);
  document.title=`${name} · ${L(settings,'siteName')}`;
  if(id('standaloneProductTitle')) id('standaloneProductTitle').textContent=name;
  contentEl.innerHTML=`
    <div class="product-detail">
      <div>
        <div class="product-gallery" ontouchstart="onProductSwipeStart(event)" ontouchend="onProductSwipeEnd(event)">
          ${imgs.length?`<img src="${esc(imgs[activeProductImageIndex])}" alt="${esc(name)}" onerror="imgFallback(this,'${esc(p.cat||'gift')}')">`:`<div class="product-gallery-emoji">${iconFor(p.cat||p.emoji||'gift','svg-icon product-vector-icon')}</div>`}
          ${imgs.length>1?`
            <button class="gallery-btn gallery-prev" type="button" onclick="changeProductImage(-1)" aria-label="${T('السابق','Previous')}">‹</button>
            <button class="gallery-btn gallery-next" type="button" onclick="changeProductImage(1)" aria-label="${T('التالي','Next')}">›</button>
            <div class="gallery-dots">${imgs.map((_,i)=>`<button class="gallery-dot ${i===activeProductImageIndex?'active':''}" type="button" onclick="setProductImage(${i})" aria-label="${i+1}"></button>`).join('')}</div>`:''}
        </div>
        ${imgs.length>1?`<div class="gallery-thumbs">${imgs.map((src,i)=>`<button class="gallery-thumb ${i===activeProductImageIndex?'active':''}" type="button" onclick="setProductImage(${i})" aria-label="${i+1}"><img src="${esc(src)}" alt=""/></button>`).join('')}</div>`:''}
      </div>
      <div class="product-detail-info">
        <div class="detail-category">${esc(catLabel(p.cat))}</div>
        <div class="detail-title">${esc(name)}</div>
        ${p.reviews>0?`<div class="product-rating">${starsHtml(p.rating)}<span>${Number(p.rating).toFixed(1)} · ${num(p.reviews)} ${T('تقييم','reviews')}</span></div>`:''}
        <div class="detail-price-row">
          <div class="detail-price">${omr(p.price)}</div>
          ${p.oldPrice?`<span class="price-old">${omr(p.oldPrice)}</span>`:''}
          ${stockLabel(p)}
        </div>
        ${productDesc(p)?`<div class="detail-desc">${esc(productDesc(p))}</div>`:''}
        ${(p.colors||[]).length?`<div><div class="detail-meta-label">${T('اللون','Colour')}</div><div class="detail-option-group">${p.colors.map((c,i)=>`<button class="detail-chip ${activeProductColor===c?'active':''}" type="button" onclick="setDetailColor(${i})">${esc(c)}</button>`).join('')}</div></div>`:''}
        <div><div class="detail-meta-label">${T('الكمية','Quantity')}</div><div class="detail-qty"><button class="qty-btn" type="button" onclick="changeDetailQty(-1)" aria-label="-">−</button><strong>${activeProductQty}</strong><button class="qty-btn" type="button" onclick="changeDetailQty(1)" aria-label="+">+</button></div></div>
        <div class="detail-actions">
          <button class="btn-primary" type="button" ${out?'disabled':''} onclick="addToCart(${Number(p.id)},activeProductQty,activeProductColor)">${iconSvg('cart')} ${out?T('غير متوفر حالياً','Currently sold out'):T('أضيفي للسلة','Add to cart')}</button>
          <button class="btn-ghost" type="button" onclick="askProductWhatsApp(${Number(p.id)})">${iconSvg('whatsapp')} ${T('اسألي عبر واتساب','Ask on WhatsApp')}</button>
        </div>
        <div class="detail-meta">
          <div class="detail-meta-item"><div class="detail-meta-label">${T('التخصيص','Personalisation')}</div><div class="detail-meta-value">${T('اكتبي اسم المدرسة أو المناسبة عند إتمام الطلب','Add your school or occasion name at checkout')}</div></div>
          <div class="detail-meta-item"><div class="detail-meta-label">${T('مدة التجهيز والتوصيل','Making & delivery time')}</div><div class="detail-meta-value">${esc(p.deliveryTime||T('٢–٥ أيام عمل','2–5 working days'))}</div></div>
          ${renderSpecTable(T('التفاصيل','Details'), p.specs)}
          ${renderDetailList(T('محتويات البوكس','What\'s in the box'), p.boxContents)}
        </div>
        ${p.reviews>0?`<div class="detail-reviews"><h4>${T('تقييمات المشترين','Customer reviews')}</h4><div class="detail-review-row">${starsHtml(p.rating)}<span>${T('التقييم متاح بعد استلام الطلب','Reviews are collected after delivery')}</span></div></div>`:''}
      </div>
    </div>
    ${similarProductsHtml(p)}`;
}
function renderStandaloneProductPage(){
  if(!document.body.classList.contains('product-page'))return;
  const contentEl=id('standaloneProductContent'); if(!contentEl)return;
  const productId=new URLSearchParams(location.search).get('id')||'';
  const p=products.find(x=>String(x.id)===String(productId));
  if(!p){
    if(!productsLoaded)return;
    contentEl.innerHTML=`<div class="empty-state">${iconSvg('gift')}<div>${T('هذا المنتج غير متوفر حالياً.','This product is not available right now.')}</div><a class="btn-primary" style="margin-top:16px" href="/shop.html">${T('تصفحي المتجر','Browse the shop')}</a></div>`;
    return;
  }
  if(String(activeProductDetailsId)!==String(p.id)){
    activeProductDetailsId=p.id; activeProductImageIndex=0;
    activeProductColor=(p.colors||[])[0]||''; activeProductQty=1;
  }
  renderProductDetails();
}

// ========================= CART =========================
function syncCartWithProducts(){
  if(!productsLoaded)return;
  cart=cart.map(item=>{
    const p=products.find(x=>String(x.id)===String(item.id));
    if(!p || p.isActive===false || Number(p.stock||0)<=0)return null;
    return {...p, qty:Math.min(Number(item.qty)||1, Number(p.stock)), selectedColor:item.selectedColor||''};
  }).filter(Boolean);
  saveCart();
}
function addToCart(pid, qty=1, color=''){
  const p=products.find(x=>String(x.id)===String(pid)); if(!p)return;
  if(Number(p.stock||0)<=0){showToast(T('هذا المنتج غير متوفر حالياً','This item is sold out'),'!');return;}
  const addQty=Math.max(1,Number(qty||1));
  const selectedColor=String(color||'').trim();
  const ex=cart.find(x=>String(x.id)===String(pid) && String(x.selectedColor||'')===selectedColor);
  const inCart=cart.filter(x=>String(x.id)===String(pid)).reduce((s,i)=>s+i.qty,0);
  if(inCart+addQty>Number(p.stock||0)){showToast(T('وصلتِ للكمية المتاحة من هذا المنتج','You\'ve reached the available quantity'),'!');return;}
  if(ex) ex.qty+=addQty; else cart.push({...p,qty:addQty,selectedColor});
  saveCart(); updateCartUI();
  const cc=id('cartCount'); if(cc){cc.classList.remove('bump');void cc.offsetWidth;cc.classList.add('bump');}
  showToast(T(`تمت إضافة ${p.name} للسلة`,`${productName(p)} added to cart`));
}
function cartItemIndex(i){ return Number(i); }
function chQty(index,d){
  const item=cart[cartItemIndex(index)]; if(!item)return;
  const sameProduct=cart.filter(x=>String(x.id)===String(item.id)).reduce((s,i)=>s+i.qty,0);
  if(d>0 && sameProduct>=Number(item.stock||0)){showToast(T('وصلتِ للكمية المتاحة من هذا المنتج','You\'ve reached the available quantity'),'!');return;}
  item.qty+=d;
  if(item.qty<=0) cart.splice(cartItemIndex(index),1);
  saveCart(); updateCartUI();
}
function updateCartUI(){
  if(id('cartCount')) id('cartCount').textContent=cart.reduce((s,i)=>s+i.qty,0);
  if(id('cartTotal')) id('cartTotal').textContent=omr(cartSubtotal());
  const itemsEl=id('cartItems'), footer=id('cartFooter');
  if(!itemsEl)return;
  if(!cart.length){
    itemsEl.innerHTML=`<div class="cart-empty">${iconSvg('gift')}<div style="font-weight:600;color:var(--olive)">${T('سلتك فارغة','Your cart is empty')}</div><div style="font-size:14px">${T('اختاري بوكس مناسبتك','Pick a box for your occasion')}</div><a class="btn-ghost btn-sm" style="margin-top:16px" href="/shop.html">${T('تصفحي المتجر','Browse the shop')}</a></div>`;
    if(footer) footer.hidden=true;
    return;
  }
  itemsEl.innerHTML=cart.map((i,index)=>`
    <div class="cart-item">
      <div class="cart-item-img">${productMainVisual(i)}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${esc(productName(i))}</div>
        ${i.selectedColor?`<div class="cart-item-meta">${T('اللون','Colour')}: ${esc(i.selectedColor)}</div>`:''}
        <div class="cart-item-price">${omr(i.price)}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" type="button" onclick="chQty(${index},-1)" aria-label="-">−</button>
          <span class="qty-num">${i.qty}</span>
          <button class="qty-btn" type="button" onclick="chQty(${index},1)" aria-label="+">+</button>
        </div>
      </div>
    </div>`).join('');
  if(footer) footer.hidden=false;
}
function openCart(event){
  if(event){event.preventDefault();event.stopPropagation();}
  id('cartOverlay').classList.add('open'); id('cartDrawer').classList.add('open');
  return false;
}
function closeCart(event){
  if(event){event.preventDefault();event.stopPropagation();}
  id('cartOverlay').classList.remove('open'); id('cartDrawer').classList.remove('open');
  return false;
}

// ========================= CHECKOUT =========================
function openOrderModal(event){
  if(event){event.preventDefault();event.stopPropagation();}
  if(!cart.length)return false;
  uploadedProof=null; checkoutReview=null; orderSubmitting=false;
  checkoutSubmissionKey=createCheckoutSubmissionKey();
  deliveryChoice=['with','without'].includes(checkoutDraft.deliveryChoice) ? checkoutDraft.deliveryChoice : 'with';
  renderOrderStep1();
  closeCart();
  id('orderOverlay').classList.add('open');
  return false;
}
function closeOrderModal(event){
  if(event){
    if(event.type==='click' && event.target!==event.currentTarget && event.currentTarget?.id==='orderOverlay')return false;
    event.preventDefault();event.stopPropagation();
  }
  id('orderOverlay').classList.remove('open');
  orderStep=0;
  return false;
}
function saveCheckoutDraft(){
  const val=k=>id(k) ? id(k).value : (checkoutDraft[{oName:'name',oWilayat:'wilayat',oArea:'area',oPhone:'phone',oGiftMessage:'giftMessage'}[k]]||'');
  checkoutDraft={
    name:val('oName').trim(), wilayat:val('oWilayat'), area:val('oArea').trim(),
    phone:omanLocalPhone(val('oPhone')), giftMessage:val('oGiftMessage'), deliveryChoice
  };
  storageSet(STORAGE.draft, JSON.stringify(checkoutDraft));
}
function fillCheckoutDraft(){
  const d=checkoutDraft;
  if(id('oName'))id('oName').value=d.name||'';
  if(id('oWilayat'))id('oWilayat').value=d.wilayat||'';
  if(id('oArea'))id('oArea').value=d.area||'';
  if(id('oPhone'))id('oPhone').value=omanLocalPhone(d.phone||'');
  if(id('oGiftMessage'))id('oGiftMessage').value=d.giftMessage||'';
  selectDelivery(deliveryChoice);
}
function stepsHtml(active){
  const labels=[T('بياناتك','Details'),T('الدفع','Payment'),T('التأكيد','Confirm')];
  return `<div class="order-steps">${labels.map((l,i)=>{
    const n=i+1, cls=n<active?'done':n===active?'active':'';
    return `<div class="step ${cls}"><div class="step-circle">${n<active?'✓':n}</div><div class="step-label">${l}</div></div>`;
  }).join('')}</div>`;
}
function cartPreviewHtml(showLineTotal=false){
  return cart.map(i=>`
    <div class="order-product-preview">
      <div class="order-product-emoji">${productMainVisual(i)}</div>
      <div>
        <div class="order-product-name">${esc(productName(i))}${showLineTotal?` × ${i.qty}`:''}</div>
        <div class="order-product-price">${showLineTotal?omr(i.price*i.qty):`${omr(i.price)} × ${i.qty}`}${i.selectedColor?` · ${esc(i.selectedColor)}`:''}</div>
      </div>
    </div>`).join('');
}
function renderOrderStep1(){
  orderStep=1;
  id('orderModalTitle').textContent=T('إتمام الطلب','Checkout');
  const totals=calcOrderTotals(cartSubtotal(), currentDeliveryCost());
  id('orderModalContent').innerHTML=`
    ${stepsHtml(1)}
    <div class="form-section-title">${iconSvg('gift')} ${T('ملخص الطلب','Order summary')}</div>
    ${cartPreviewHtml()}
    <div class="form-section-title">${iconSvg('pen')} ${T('بياناتك','Your details')}</div>
    <div class="form-group"><label class="form-label" for="oName">${T('الاسم الكامل','Full name')} *</label><input class="form-input" id="oName" autocomplete="name" oninput="saveCheckoutDraft()"/></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="oWilayat">${T('المحافظة','Governorate')} *</label>
        <select class="form-select" id="oWilayat" onchange="saveCheckoutDraft()">
          <option value="">${T('اختاري المحافظة','Choose governorate')}</option>
          ${WILAYATS.map(([ar,en])=>`<option value="${esc(ar)}">${esc(T(ar,en))}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label" for="oArea">${T('الولاية / المنطقة','Wilayat / area')} *</label><input class="form-input" id="oArea" placeholder="${T('مثال: السيب، الخوض','e.g. Seeb, Al Khoudh')}" oninput="saveCheckoutDraft()"/></div>
    </div>
    <div class="form-group"><label class="form-label" for="oPhone">${T('رقم الواتساب','WhatsApp number')} *</label><input class="form-input" id="oPhone" placeholder="9XXXXXXX" dir="ltr" inputmode="numeric" autocomplete="tel" oninput="saveCheckoutDraft()" onblur="normalizeOmanPhoneField(this);saveCheckoutDraft()"/><div class="form-hint">${T('٨ أرقام عُمانية — سنرسل لك تحديثات الطلب عليه.','8-digit Omani number — we\'ll send order updates here.')}</div></div>
    <div class="form-group"><label class="form-label" for="oGiftMessage">${T('تفاصيل التخصيص','Personalisation details')}</label><textarea class="form-input" id="oGiftMessage" rows="3" maxlength="500" placeholder="${T('مثال: مدرسة النهضة — يوم الزراعة العماني — الصف الثالث، وتاريخ الاستلام المطلوب','e.g. Al Nahda School — Omani Agriculture Day — Grade 3, and the date you need it')}" oninput="saveCheckoutDraft()"></textarea><div class="form-hint">${T('اسم المدرسة أو المناسبة، الثيم أو الألوان، وأي ملاحظة.','School or occasion name, theme or colours, and any notes.')}</div></div>
    <div class="form-section-title">${iconSvg('truck')} ${T('طريقة الاستلام','Delivery method')}</div>
    <div class="delivery-toggle">
      <label class="delivery-opt ${deliveryChoice==='with'?'selected':''}" id="dOpt1" onclick="selectDelivery('with')"><input type="radio" name="delivery" value="with" ${deliveryChoice==='with'?'checked':''}/><strong>${iconSvg('truck')} ${T('توصيل للبيت','Home delivery')}</strong><small>${omr(settings.deliveryCost)}</small></label>
      <label class="delivery-opt ${deliveryChoice==='without'?'selected':''}" id="dOpt2" onclick="selectDelivery('without')"><input type="radio" name="delivery" value="without" ${deliveryChoice==='without'?'checked':''}/><strong>${iconSvg('box')} ${T('استلام بنفسي','I\'ll pick it up')}</strong><small>${T('بدون رسوم — نرسل لك موقع الاستلام','Free — we\'ll send you the pickup location')}</small></label>
    </div>
    <div class="price-summary">
      <div class="price-row"><span>${T('المنتجات','Items')}</span><span>${omr(totals.base)}</span></div>
      <div class="price-row" id="discountRow" ${totals.discount?'':'hidden'}><span>${T('خصم الكوبون','Coupon discount')}</span><span id="discountTotal">-${omr(totals.discount)}</span></div>
      <div class="price-row" id="deliveryRow"><span>${T('التوصيل','Delivery')}</span><span id="deliveryTotal">${omr(totals.delivery)}</span></div>
      <div class="price-row" id="vatRow" ${Number(settings.vatRate||0)>0?'':'hidden'}><span>${T('ضريبة القيمة المضافة','VAT')} (${Number(settings.vatRate||0)}%)</span><span id="vatTotal">${omr(totals.vat)}</span></div>
      <div class="price-row total-row"><span>${T('الإجمالي','Total')}</span><span id="grandTotal">${omr(totals.grand)}</span></div>
    </div>
    ${normalizedCoupons().some(c=>c.active)?`
    <div class="coupon-row">
      <input class="form-input" id="couponCode" placeholder="${T('كود الخصم','Discount code')}" dir="ltr" value="${appliedCoupon?esc(appliedCoupon.code):''}" aria-label="${T('كود الخصم','Discount code')}"/>
      <button class="btn-ghost" type="button" onclick="applyCouponFromInput()">${T('تطبيق','Apply')}</button>
    </div>
    <div class="coupon-message ${appliedCoupon?'ok':''}" id="couponMessage">${appliedCoupon?T('تم تطبيق الكوبون.','Coupon applied.'):''}</div>`:''}
    <button class="btn-primary btn-block" type="button" onclick="goToStep2()">${T('التالي: الدفع','Next: payment')} ${iconSvg('arrow','svg-icon flip-rtl')}</button>`;
  fillCheckoutDraft();
}
function applyCouponFromInput(){
  const code=String(id('couponCode')?.value||'').trim().toUpperCase();
  const message=id('couponMessage');
  const coupon=code ? normalizedCoupons().find(c=>c.active && c.code===code) : null;
  appliedCoupon=coupon||null;
  if(message){
    message.textContent=!code?'':coupon?T('تم تطبيق الكوبون.','Coupon applied.'):T('الكوبون غير صحيح أو غير مفعل.','This code is invalid or inactive.');
    message.classList.toggle('ok',Boolean(coupon));
  }
  selectDelivery(deliveryChoice);
}
function selectDelivery(v){
  deliveryChoice=v==='without'?'without':'with';
  if(id('dOpt1'))id('dOpt1').classList.toggle('selected',deliveryChoice==='with');
  if(id('dOpt2'))id('dOpt2').classList.toggle('selected',deliveryChoice==='without');
  const totals=calcOrderTotals(cartSubtotal(), currentDeliveryCost());
  if(id('deliveryTotal')) id('deliveryTotal').textContent=deliveryChoice==='with'?omr(totals.delivery):T('مجاناً','Free');
  if(id('discountRow')) id('discountRow').hidden=!totals.discount;
  if(id('discountTotal')) id('discountTotal').textContent='-'+omr(totals.discount);
  if(id('vatTotal')) id('vatTotal').textContent=omr(totals.vat);
  if(id('grandTotal')) id('grandTotal').textContent=omr(totals.grand);
  if(id('oName'))saveCheckoutDraft();
}
function goToStep2(){
  saveCheckoutDraft();
  const {name,wilayat,area,phone,giftMessage}=checkoutDraft;
  if(id('oPhone')) id('oPhone').value=phone;
  if(!name||!wilayat||!area||!phone){showToast(T('يرجى تعبئة جميع الحقول المطلوبة','Please fill in all required fields'),'!');return;}
  if(phone.length!==8){showToast(T('رقم الواتساب يجب أن يكون ٨ أرقام عُمانية','WhatsApp number must be 8 Omani digits'),'!');return;}
  const totals=calcOrderTotals(cartSubtotal(), currentDeliveryCost());
  checkoutReview={name,wilayat,area,phone,giftMessage:String(giftMessage||'').trim(),grand:totals.grand,proofFile:uploadedProof||null};
  renderOrderStep2();
}
function renderOrderStep2(){
  orderStep=2;
  if(!checkoutReview){renderOrderStep1();return;}
  const grand=checkoutReview.grand;
  id('orderModalTitle').textContent=T('الدفع','Payment');
  id('orderModalContent').innerHTML=`
    ${stepsHtml(2)}
    <div class="payment-details-card">
      <div>${T('المبلغ المطلوب','Amount to transfer')}: <strong class="amount">${omr(grand)}</strong></div>
      ${settings.paymentPhone?`<div>${T('التحويل لرقم الهاتف','Transfer to phone')}: <strong dir="ltr">${esc(omanLocalPhone(settings.paymentPhone))}</strong></div>`:''}
      ${settings.bankName?`<div>${T('البنك','Bank')}: <strong>${esc(settings.bankName)}</strong></div>`:''}
      ${settings.bankAccount?`<div>${T('رقم الحساب / IBAN','Account / IBAN')}: <strong dir="ltr">${esc(settings.bankAccount)}</strong></div>`:''}
      ${!settings.paymentPhone&&!settings.bankName&&!settings.bankAccount?`<div>${T('سنرسل لك بيانات التحويل على واتساب.','We\'ll send you the transfer details on WhatsApp.')}</div>`:''}
      <div class="note">${T('بعد التحويل أرفقي صورة أو PDF للإيصال. نبدأ تجهيز طلبك بعد تأكيد التحويل.','After transferring, attach a photo or PDF of the receipt. We start preparing once the payment is confirmed.')}</div>
    </div>
    <div class="receipt-box">
      <label class="form-label" for="paymentProof">${iconSvg('paperclip')} ${T('إرفاق الإيصال','Attach receipt')} *</label>
      <input id="paymentProof" name="paymentProof" type="file" accept="image/*,application/pdf" onchange="previewPaymentProof(this)"/>
      <div id="proofPreview" style="margin-top:10px;"></div>
      <div class="form-hint">${T('صورة أو PDF، الحد الأقصى 8MB.','Image or PDF, up to 8MB.')}</div>
    </div>
    <div class="btn-pair">
      <button class="btn-ghost" type="button" onclick="renderOrderStep1()">${iconSvg('arrow','svg-icon flip-ltr')} ${T('رجوع','Back')}</button>
      <button class="btn-primary" type="button" onclick="goToStep3()">${T('مراجعة الطلب','Review order')} ${iconSvg('arrow','svg-icon flip-rtl')}</button>
    </div>`;
  renderPaymentProofPreview(currentPaymentProof());
}
function rememberPaymentProof(file){
  if(file){ uploadedProof=file; if(checkoutReview)checkoutReview.proofFile=file; }
  return uploadedProof;
}
function currentPaymentProof(){
  const inputFile=id('paymentProof')?.files?.[0] || null;
  if(inputFile)return rememberPaymentProof(inputFile);
  return checkoutReview?.proofFile || uploadedProof || null;
}
function renderPaymentProofPreview(file){
  const target=id('proofPreview'); if(!target)return;
  if(!file){target.innerHTML='';return;}
  const safeName=esc(file.name||'receipt');
  if(String(file.type||'').startsWith('image/')){
    const reader=new FileReader();
    reader.onload=e=>{ target.innerHTML=`<div style="display:flex;align-items:center;gap:10px;font-size:13px;"><img src="${e.target.result}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;"/><span>${safeName}</span></div>`; };
    reader.readAsDataURL(file);
  }else{
    target.innerHTML=`<div style="font-size:13px;">PDF: ${safeName}</div>`;
  }
}
function previewPaymentProof(input){
  const file=input?.files?.[0]||null;
  if(file && file.size>8*1024*1024){ input.value=''; showToast(T('حجم الملف أكبر من 8MB','File is larger than 8MB'),'!'); return; }
  renderPaymentProofPreview(rememberPaymentProof(file));
}
function goToStep3(){
  if(!checkoutReview){renderOrderStep1();return;}
  const proof=currentPaymentProof();
  if(!proof){showToast(T('إرفاق الإيصال مطلوب','Please attach the receipt'),'!');return;}
  checkoutReview.proofFile=proof;
  renderOrderStep3();
}
function renderOrderStep3(){
  orderStep=3;
  const d=checkoutReview; if(!d){renderOrderStep1();return;}
  const totals=calcOrderTotals(cartSubtotal(), currentDeliveryCost());
  const wil=WILAYATS.find(w=>w[0]===d.wilayat);
  id('orderModalTitle').textContent=T('مراجعة الطلب','Review order');
  id('orderModalContent').innerHTML=`
    ${stepsHtml(3)}
    <div class="price-summary">
      <div class="price-row"><span>${T('الاسم','Name')}</span><span>${esc(d.name)}</span></div>
      <div class="price-row"><span>${T('العنوان','Address')}</span><span>${esc(wil?T(wil[0],wil[1]):d.wilayat)} / ${esc(d.area)}</span></div>
      <div class="price-row"><span>${T('الواتساب','WhatsApp')}</span><span dir="ltr">${esc(d.phone)}</span></div>
      ${d.giftMessage?`<div class="price-row"><span>${T('تفاصيل التخصيص','Personalisation')}</span><span>${esc(d.giftMessage)}</span></div>`:''}
      <div class="price-row"><span>${T('الإيصال','Receipt')}</span><span>${esc(d.proofFile?.name||T('مرفق','Attached'))}</span></div>
    </div>
    ${cartPreviewHtml(true)}
    <div class="price-summary">
      <div class="price-row"><span>${T('المنتجات','Items')}</span><span>${omr(totals.base)}</span></div>
      ${totals.discount?`<div class="price-row"><span>${T('خصم الكوبون','Coupon discount')}</span><span>-${omr(totals.discount)}</span></div>`:''}
      <div class="price-row"><span>${T('التوصيل','Delivery')}</span><span>${deliveryChoice==='with'?omr(totals.delivery):T('استلام بنفسي','Pickup')}</span></div>
      ${totals.vat?`<div class="price-row"><span>${T('ضريبة القيمة المضافة','VAT')}</span><span>${omr(totals.vat)}</span></div>`:''}
      <div class="price-row total-row"><span>${T('الإجمالي','Total')}</span><span>${omr(totals.grand)}</span></div>
    </div>
    <div class="btn-pair">
      <button class="btn-ghost" type="button" onclick="renderOrderStep1()">${T('تعديل البيانات','Edit details')}</button>
      <button class="btn-primary" type="button" id="submitOrderBtn" onclick="submitReviewedOrder()">${T('تأكيد وإرسال الطلب','Confirm & place order')}</button>
    </div>`;
}
function submitReviewedOrder(){
  if(!checkoutReview){renderOrderStep1();return;}
  const proof=currentPaymentProof();
  if(!proof){showToast(T('إرفاق الإيصال مطلوب','Please attach the receipt'),'!');return;}
  submitOrder(proof);
}
function submitOrder(proof){
  if(orderSubmitting){showToast(T('جاري إرسال الطلب، لحظة من فضلك','Sending your order, one moment'),'…');return;}
  orderSubmitting=true;
  const btn=id('submitOrderBtn'); if(btn){btn.disabled=true;btn.textContent=T('جاري الإرسال…','Sending…');}
  if(!checkoutSubmissionKey)checkoutSubmissionKey=createCheckoutSubmissionKey();
  const d=checkoutReview;
  const deliveryCost=currentDeliveryCost();
  const totals=calcOrderTotals(cartSubtotal(),deliveryCost);
  const items=cart.map(i=>({id:i.id,name:i.name,price:i.price,qty:i.qty,selectedColor:i.selectedColor||'',cat:i.cat,emoji:i.emoji}));
  const payment=appliedCoupon ? `bank_transfer | coupon ${appliedCoupon.code} -${totals.discount.toFixed(3)}` : 'bank_transfer';
  const form=new FormData();
  form.append('clientOrderKey',checkoutSubmissionKey);
  form.append('name',d.name);
  form.append('wilayat',d.wilayat);
  form.append('area',d.area);
  form.append('phone',d.phone);
  form.append('giftMessage',d.giftMessage||'');
  form.append('items',JSON.stringify(items));
  form.append('delivery',deliveryChoice);
  form.append('deliveryCost',deliveryCost);
  form.append('vatRate',Number(settings.vatRate||0));
  form.append('vatAmount',totals.vat);
  form.append('total',totals.grand);
  form.append('payment',payment);
  form.append('proof',proof);
  fetch(API_BASE+'/orders',{method:'POST',body:form,credentials:'include'}).then(async r=>{
    const j=await r.json().catch(()=>({}));
    if(!r.ok || !(j && j.ok)){
      const err=new Error(j?.error||'');
      err.status=r.status; throw err;
    }
    const orderId=j.orderId || j.order?.id || checkoutSubmissionKey;
    saveCustomerOrder({
      id:orderId, phone:d.phone, total:totals.grand, status:'new',
      date:new Date().toISOString(), items:items.map(i=>({name:i.name,qty:i.qty,price:i.price}))
    });
    showSuccessScreen(orderId,d.name);
    cart=[]; saveCart(); updateCartUI(); fetchProducts();
    appliedCoupon=null; checkoutDraft={deliveryChoice}; storageSet(STORAGE.draft, JSON.stringify(checkoutDraft));
    uploadedProof=null; checkoutReview=null; checkoutSubmissionKey=''; orderSubmitting=false;
  }).catch(e=>{
    orderSubmitting=false;
    if(btn){btn.disabled=false;btn.textContent=T('تأكيد وإرسال الطلب','Confirm & place order');}
    const msg=e?.status===409 ? T('تغيرت الأسعار أو الكمية المتاحة، حدّثي الصفحة وحاولي مرة أخرى.','Prices or stock changed — please refresh and try again.')
      : T('تعذر إرسال الطلب، حاولي مرة أخرى أو راسلينا على واتساب.','We couldn\'t send your order — please try again or message us on WhatsApp.');
    showToast(msg,'!');
  });
}
function showSuccessScreen(orderId,name){
  orderStep=4;
  id('orderModalTitle').textContent=T('تم استلام طلبك','Order received');
  id('orderModalContent').innerHTML=`
    <div class="success-screen">
      <div class="success-icon">${iconSvg('heart')}</div>
      <div class="success-title">${T(`شكراً ${esc(name)}!`,`Thank you, ${esc(name)}!`)}</div>
      <p class="success-sub">${T('وصلنا طلبك، وسنراجع الإيصال ونؤكد لك على واتساب قريباً. صُنعت لكم بعناية وحب 🫶🏻','We\'ve received your order. We\'ll check the receipt and confirm on WhatsApp shortly.')}</p>
      <div class="success-order-id">${esc(orderId)}</div>
      <div class="success-note">${T('احتفظي برقم الطلب لتتبعه من «تتبع الطلب» أو صفحة «طلباتي».','Keep this order number to track it from “Track order” or “My orders”.')}</div>
      <div class="btn-pair">
        <button class="btn-primary" type="button" onclick="closeOrderModal()">${T('متابعة التسوق','Continue shopping')}</button>
        <a class="btn-ghost" href="${whatsappUrl(settings.waNumber,T('مرحباً، أريد متابعة طلبي رقم ','Hello, I\'d like to follow up on order ')+orderId)}" target="_blank" rel="noopener">${iconSvg('whatsapp')} ${T('واتساب المتجر','WhatsApp us')}</a>
      </div>
    </div>`;
}

// ========================= MY ORDERS / TRACKING =========================
function customerOrders(){
  const saved=readJson(STORAGE.orders,[]);
  return Array.isArray(saved)?saved:[];
}
function saveCustomerOrder(order){
  if(!order||!order.id)return;
  const saved=customerOrders().filter(o=>String(o.id)!==String(order.id));
  saved.unshift(order);
  storageSet(STORAGE.orders, JSON.stringify(saved.slice(0,20)));
}
function formatDate(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return String(value||'');
  return d.toLocaleDateString(lang==='en'?'en-GB':'ar-OM',{year:'numeric',month:'short',day:'numeric',numberingSystem:'latn'});
}
function renderMyOrdersPage(){
  if(!document.body.classList.contains('my-orders-page'))return;
  const target=id('myOrdersContent'); if(!target)return;
  const saved=customerOrders();
  if(!saved.length){
    target.innerHTML=`
      <div class="my-orders-empty">
        ${iconSvg('box')}
        <h2>${T('لا توجد طلبات محفوظة على هذا الجهاز','No orders saved on this device')}</h2>
        <p>${T('إذا طلبتِ من جهاز آخر، استخدمي «تتبع الطلب» برقم الطلب ورقم الهاتف.','If you ordered from another device, use “Track order” with your order number and phone.')}</p>
        <div class="btn-pair" style="justify-content:center;max-width:460px;margin:0 auto;">
          <a class="btn-primary" href="/shop.html">${T('تصفحي المتجر','Browse the shop')}</a>
          <button class="btn-ghost" type="button" onclick="openTrackOrder()">${T('تتبع طلب','Track an order')}</button>
        </div>
      </div>`;
    return;
  }
  target.innerHTML=`<div class="my-orders-list">${saved.map(order=>`
    <article class="my-order-card">
      <div>
        <h3>${esc(order.id)}</h3>
        <p>${esc((order.items||[]).map(i=>`${i.name} × ${i.qty}`).join('، '))}</p>
        <p>${esc(formatDate(order.date))} · ${omr(Number(order.total||0))}</p>
      </div>
      <div class="my-order-actions">
        <button class="btn-ghost btn-sm" type="button" onclick="prefillTrackOrder('${esc(order.id)}','${esc(order.phone||'')}',true)">${T('تتبع الطلب','Track order')}</button>
        <a class="btn-primary btn-sm" href="${whatsappUrl(settings.waNumber,T('مرحباً، أريد متابعة طلبي رقم ','Hello, I\'d like to follow up on order ')+order.id)}" target="_blank" rel="noopener">${iconSvg('whatsapp')} ${T('واتساب','WhatsApp')}</a>
      </div>
    </article>`).join('')}</div>`;
}
function openTrackOrder(){ id('trackOrderOverlay').classList.add('open'); setTimeout(()=>id('trackOrderId')?.focus(),50); }
function closeTrackOrder(){ id('trackOrderOverlay').classList.remove('open'); }
function prefillTrackOrder(orderId, phone='', autoSubmit=false){
  closeOrderModal(); openTrackOrder();
  id('trackOrderId').value=orderId;
  if(phone) id('trackPhone').value=omanLocalPhone(phone);
  if(autoSubmit && phone) trackOrder();
}
function statusBadge(s,label){
  const cls={new:'status-new',payment_confirmed:'status-processing',processing:'status-processing',ready_for_final_delivery:'status-processing',out_for_delivery:'status-shipped',shipped:'status-shipped',delivered:'status-done',done:'status-done',cancelled:'status-cancelled'};
  return `<span class="order-status ${cls[s]||'status-new'}">${esc(statusText(s,label))}</span>`;
}
function trackOrder(){
  const orderId=id('trackOrderId').value.trim();
  const phone=omanLocalPhone(id('trackPhone').value);
  id('trackPhone').value=phone;
  const result=id('trackResult');
  if(!orderId||!phone){showToast(T('أدخلي رقم الطلب ورقم الهاتف','Enter the order number and phone'),'!');return;}
  if(phone.length!==8){showToast(T('رقم الهاتف يجب أن يكون ٨ أرقام عُمانية','Phone must be 8 Omani digits'),'!');return;}
  result.innerHTML=`<div class="track-card">${T('جاري البحث…','Searching…')}</div>`;
  fetch(`${API_BASE}/orders/track?orderId=${encodeURIComponent(orderId)}&phone=${encodeURIComponent(phone)}`)
    .then(r=>r.json())
    .then(j=>{
      if(!j.success)throw new Error('not found');
      const o=j.order;
      result.innerHTML=`
        <div class="track-card">
          <div style="font-weight:700;font-size:16px;margin-bottom:6px;direction:ltr;text-align:start">${esc(o.id)}</div>
          <div>${T('الحالة','Status')}: ${statusBadge(o.status,o.statusLabel)}</div>
          <div>${T('الاسم','Name')}: ${esc(o.name)}</div>
          <div>${T('العنوان','Address')}: ${esc(o.wilayat)} / ${esc(o.area)}</div>
          <div>${T('الإجمالي','Total')}: ${omr(Number(o.total||0))}</div>
          <div style="margin-top:6px;">${(o.items||[]).map(i=>`${esc(i.name)} × ${Number(i.qty||1)}`).join('<br/>')}</div>
        </div>`;
    })
    .catch(()=>{ result.innerHTML=`<div class="track-card error">${T('لم نجد الطلب. تأكدي من رقم الطلب ورقم الهاتف.','Order not found. Please check the order number and phone.')}</div>`; });
}

// ========================= POLICIES / REVIEWS =========================
function openPolicy(type){
  const content={
    faq:[T('الأسئلة الشائعة','FAQ'),[
      T('هل السعر للقطعة أم للبوكس؟ السعر لكل بوكس، وعدد التوزيعات مكتوب في اسم المنتج (مثال: 32 توزيعة).','Is the price per piece or per box? Per box — the number of pieces is in the product name (e.g. 32 pieces).'),
      T('هل يمكن تغيير الثيم أو إضافة اسم المدرسة؟ نعم، اكتبي التفاصيل في «تفاصيل التخصيص» عند الطلب أو راسلينا على واتساب.','Can you change the theme or add the school name? Yes — write it in “Personalisation details” at checkout or message us on WhatsApp.'),
      T('كم يستغرق التجهيز؟ حسب الكمية والتصميم، لذا اطلبي مبكراً قبل موعد المناسبة واذكري التاريخ المطلوب.','How long does it take? It depends on quantity and design, so order early and tell us the date you need.'),
      T('كيف أدفع؟ تأكيد الطلب عند التحويل، ولا يوجد دفع عند الاستلام. أرفقي صورة الإيصال مع الطلب.','How do I pay? Orders are confirmed on transfer — no cash on delivery. Attach the receipt to your order.'),
      T('هل توصلون لكل عُمان؟ نعم، يوجد توصيل لجميع أنحاء السلطنة، ويمكنك اختيار الاستلام بنفسك.','Do you deliver across Oman? Yes, anywhere in the Sultanate — or choose pickup.')
    ]],
    returns:[T('الاستبدال والإرجاع','Exchanges & returns'),[
      T('لأن التوزيعات تُطبع وتُجهز حسب الطلب وبثيم مناسبتك، لا يمكن إرجاع الطلبات المخصصة.','Because favours are printed and prepared to order in your theme, personalised orders can\'t be returned.'),
      T('إذا وصلك الطلب ناقصاً أو متضرراً، راسلينا على واتساب خلال ٢٤ ساعة من الاستلام مع صورة وسنعالج الأمر.','If your order arrives incomplete or damaged, message us on WhatsApp within 24 hours of delivery with a photo and we\'ll make it right.')
    ]]
  }[type] || [T('معلومات المتجر','Store information'),[T('تواصلي معنا عبر واتساب لأي استفسار.','Message us on WhatsApp with any question.')]];
  id('policyTitle').textContent=content[0];
  id('policyContent').innerHTML=`<div class="policy-text">${content[1].map(p=>`<p>${esc(p)}</p>`).join('')}</div>
    <a class="btn-primary" style="margin-top:18px;" href="${whatsappUrl(settings.waNumber)}" target="_blank" rel="noopener">${iconSvg('whatsapp')} ${T('تواصلي عبر واتساب','Message us on WhatsApp')}</a>`;
  id('policyOverlay').classList.add('open');
}
function closePolicy(){ id('policyOverlay').classList.remove('open'); }
function openReviewFromHash(){
  const params=new URLSearchParams(String(location.hash||'').replace(/^#/,''));
  const orderId=params.get('review');
  const phone=omanLocalPhone(params.get('phone')||'');
  if(!orderId||!phone)return;
  fetch(`${API_BASE}/orders/track?orderId=${encodeURIComponent(orderId)}&phone=${encodeURIComponent(phone)}`)
    .then(r=>r.json())
    .then(j=>{
      if(!j.success)throw new Error('not found');
      const items=j.order.items||[];
      selectedReviewRating=5;
      id('policyTitle').textContent=T('قيّمي طلبك','Rate your order');
      id('policyContent').innerHTML=`
        <div class="review-card">${T('سعداء بوصول طلبك! رأيك يساعدنا نصنع قطعاً أجمل.','We\'re happy your order arrived! Your feedback helps us make even lovelier pieces.')}</div>
        <div class="form-group"><label class="form-label" for="reviewProduct">${T('المنتج','Product')}</label><select class="form-select" id="reviewProduct">${items.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select></div>
        <div class="form-group"><span class="form-label">${T('التقييم','Rating')}</span><div class="review-stars" id="reviewStars">${[1,2,3,4,5].map(v=>`<button class="review-star active" type="button" onclick="setReviewRating(${v})" aria-label="${v}/5">★</button>`).join('')}</div></div>
        <div class="form-group"><label class="form-label" for="reviewComment">${T('ملاحظتك','Your comment')}</label><textarea class="form-input" id="reviewComment" rows="4"></textarea></div>
        <button class="btn-primary" type="button" onclick="submitReview('${esc(orderId)}','${esc(phone)}')">${T('إرسال التقييم','Send review')}</button>`;
      id('policyOverlay').classList.add('open');
    })
    .catch(()=>showToast(T('رابط التقييم غير صالح أو الطلب غير مكتمل','This review link is invalid or the order isn\'t complete'),'!'));
}
function setReviewRating(value){
  selectedReviewRating=Math.max(1,Math.min(5,Number(value||5)));
  document.querySelectorAll('#reviewStars .review-star').forEach((star,i)=>star.classList.toggle('active', i<selectedReviewRating));
}
function submitReview(orderId,phone){
  fetch(API_BASE+'/reviews',{
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body:JSON.stringify({orderId,phone,productId:id('reviewProduct').value,rating:selectedReviewRating,comment:id('reviewComment').value})
  }).then(r=>r.json()).then(j=>{
    if(!j.success)throw new Error(j.error||'review failed');
    showToast(T('شكراً لك، تم حفظ تقييمك','Thank you — your review was saved'));
    closePolicy(); fetchProducts();
  }).catch(e=>showToast(e.message==='Review already submitted'?T('تم إرسال تقييم لهذا المنتج مسبقاً','You already reviewed this product'):T('تعذر حفظ التقييم','Could not save the review'),'!'));
}

// ========================= NAV / MISC =========================
function toggleMenu(){ id('mobileMenu').classList.toggle('open'); }
function closeMenu(){ id('mobileMenu').classList.remove('open'); }
function updateNavActive(){
  const path=location.pathname;
  const active=(path.endsWith('/shop.html')||path.endsWith('/product.html'))?'products':path.endsWith('/my-orders.html')?'my-orders':path.endsWith('/about.html')?'about':'home';
  document.querySelectorAll('.nav-links a[data-nav]').forEach(a=>{
    a.classList.toggle('active',a.dataset.nav===active);
    if(a.dataset.nav===active)a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
  });
}
function renderAll(){
  applyLangToDocument();
  applySettings(); renderTicker(); renderCategoryCards(); renderCategoryButtons(); renderFooterCategories();
  renderSortOptions(); renderServices(); renderAds(); renderProducts(); renderStandaloneProductPage();
  updateCartUI(); renderMyOrdersPage();
}
function rerenderOpenCheckout(){
  if(!id('orderOverlay')?.classList.contains('open'))return;
  if(orderStep===1){ saveCheckoutDraft(); renderOrderStep1(); }
  else if(orderStep===2)renderOrderStep2(); else if(orderStep===3)renderOrderStep3();
}
window.addEventListener('scroll',()=>{ id('siteNav')?.classList.toggle('scrolled', window.scrollY>12); },{passive:true});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  closeCart(); closePolicy(); closeTrackOrder();
  if(id('orderOverlay')?.classList.contains('open')) closeOrderModal();
});

// Init
(function init(){
  const catParam=new URLSearchParams(location.search).get('cat');
  if(catParam) activeFilter=categorySlug(catParam);
  if(location.hash==='#track') setTimeout(openTrackOrder,100);
  updateNavActive();
  renderAll();
  loadSettings();
  fetchProducts();
  openReviewFromHash();
})();
