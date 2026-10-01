const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve('routes/wfs.js'), 'utf8');
const start = source.indexOf('  const decodeXmlEntities =');
const end = source.indexOf('  const parseWfsXmlToQuery =', start);
assert.ok(start >= 0 && end > start, 'Could not locate the WFS filter parser');

const context = {};
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}; globalThis.convert = ogcFilterXmlToQgisExpression;`, context);

const filter = `
  <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
    <ogc:PropertyIsLike wildCard="*" singleChar="." escape="!" matchCase="false">
      <ogc:PropertyName>label</ogc:PropertyName>
      <ogc:Literal>*A&gt;B &amp; C&lt;D &quot;Q&quot; &apos;O&apos;*</ogc:Literal>
    </ogc:PropertyIsLike>
  </ogc:Filter>`;

assert.equal(
  context.convert(filter),
  `lower("label") LIKE lower('%A>B & C<D "Q" ''O''%')`
);

const numericEntities = `
  <Filter>
    <PropertyIsEqualTo>
      <PropertyName>code</PropertyName>
      <Literal>A&#62;B&#x3c;C</Literal>
    </PropertyIsEqualTo>
  </Filter>`;

assert.equal(context.convert(numericEntities), `"code" = 'A>B<C'`);
console.log('WFS search symbol checks passed for Hajk and Origo.');