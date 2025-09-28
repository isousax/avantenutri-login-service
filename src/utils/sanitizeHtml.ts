// Lightweight HTML sanitizer for blog content in a constrained Workers environment.
// It is NOT a full HTML parser; it's a pragmatic allow/strip approach for trusted author content.
// Strategy:
// 1. Remove dangerous whole tags (script/style/iframe/object/embed/video/audio/source/link/meta)
// 2. Strip event handler & style attributes (on*, style=)
// 3. Whitelist remaining tags; if a tag is not in allowlist, we keep its inner text (strip tags)
// 4. Sanitize attributes for allowed tags: src/href limited protocols, remove javascript:, data URLs only for images.
// 5. Enforce rel="noopener" for target="_blank" links.

const ALLOWED_TAGS = new Set([
  'p','br','strong','b','em','i','u','ul','ol','li','a','blockquote','code','pre','h1','h2','h3','h4','h5','h6',
  'img','figure','figcaption','hr','table','thead','tbody','tr','th','td','span'
]);

// Allowed attributes per tag (generic subset)
const GLOBAL_ALLOWED_ATTR = new Set(['id','class','title','lang']);
const TAG_ATTR: Record<string, Set<string>> = {
  a: new Set(['href','target','rel']),
  img: new Set(['src','alt','width','height','loading']),
  code: new Set(['data-lang']),
  pre: new Set(['data-lang'])
};

function sanitizeAttributes(tag: string, rawAttrs: string): string {
  if(!rawAttrs) return '';
  const attrs: string[] = [];
  const attrRegex = /(\w[\w:-]*)(\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g; // basic attribute capture
  let m: RegExpExecArray | null;
  while((m = attrRegex.exec(rawAttrs))){
    const name = m[1].toLowerCase();
    let value = '';
    if(m[2]){
      value = m[2].trim().replace(/^=/,'').trim();
      if((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))){
        value = value.slice(1,-1);
      }
    }
    // drop event handlers & style & data attributes not whitelisted
    if(name.startsWith('on') || name === 'style') continue;
    const allowedForTag = TAG_ATTR[tag] || new Set();
    if(!(GLOBAL_ALLOWED_ATTR.has(name) || allowedForTag.has(name))) continue;
    if(name === 'href'){
      const lower = value.toLowerCase();
      if(!(lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('/') || lower.startsWith('#') || lower.startsWith('mailto:'))) continue;
    }
    if(name === 'src'){
      const lower = value.toLowerCase();
      if(!(lower.startsWith('http://') || lower.startsWith('https://') || (tag === 'img' && lower.startsWith('data:image/')))) continue;
    }
    if(name === 'target'){
      if(!['_blank','_self'].includes(value)) continue;
    }
    if(name === 'rel'){
      // allow will adjust later for target blank
    }
    // basic escaping of quotes & ampersands
    const safeValue = value.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    attrs.push(`${name}="${safeValue}"`);
  }
  // ensure rel noopener
  if(tag === 'a'){
    const hasTargetBlank = /target="_blank"/i.test(attrs.join(' '));
    if(hasTargetBlank && !/rel=/i.test(attrs.join(' '))){
      attrs.push('rel="noopener"');
    }
  }
  return attrs.length? ' ' + attrs.join(' ') : '';
}

export function sanitizeHtml(input: string): string {
  if(!input) return '';
  let html = input;
  // 1. Remove dangerous whole tags (greedy minimal; nested same tag rare in authored content)
  html = html.replace(/<\s*(script|style|iframe|object|embed|video|audio|source|link|meta)[^>]*>[\s\S]*?<\/\s*\1>/gi, '');
  // 2. Remove standalone opening/closing of those
  html = html.replace(/<\/?\s*(script|style|iframe|object|embed|video|audio|source|link|meta)[^>]*>/gi,'');
  // 3. Remove comments
  html = html.replace(/<!--([\s\S]*?)-->/g,'');
  // 4. Process tags
  const tagRegex = /<([^>]+)>/g;
  html = html.replace(tagRegex, (full, inner) => {
    const isEnd = inner.startsWith('/');
    const tagNameMatch = inner.match(/^\/?\s*([a-zA-Z0-9:-]+)/);
    if(!tagNameMatch) return '';
    const tag = tagNameMatch[1].toLowerCase();
    if(!ALLOWED_TAGS.has(tag)){
      return ''; // strip unknown tag entirely (keep text already outside)
    }
    if(isEnd){
      return `</${tag}>`;
    }
    // self closing?
    const selfClose = /\/$/.test(inner.trim());
    // extract attributes portion
    const attrPortion = inner.replace(/^\s*([a-zA-Z0-9:-]+)/,'').replace(/\/$/,'');
    const safeAttrs = sanitizeAttributes(tag, attrPortion);
    return `<${tag}${safeAttrs}${selfClose? ' /':''}>`;
  });
  return html;
}

export default sanitizeHtml;