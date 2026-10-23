import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerWfsRoutes } from '../routes/wfs.js';

const registeredRoutes = new Map();
const app = new Proxy({}, {
  get: (_target, method) => (...args) => {
    registeredRoutes.set(`${String(method)}:${args[0]}`, args.at(-1));
  }
});

let renderedParams;
registerWfsRoutes({
  app,
  tileRendererPool: {
    renderTile: async (params) => {
      renderedParams = params;
      return { status: 'error', code: 'NotFound', message: 'Layer not found' };
    }
  },
  ensureProjectAccessFromQuery: () => (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
  security: {},
  findProjectById: () => ({ file: 'test-project.qgz' }),
  readProjectConfig: () => ({}),
  logProjectEvent: () => {}
});

const postHandler = registeredRoutes.get('post:/wfs');
assert.equal(typeof postHandler, 'function', 'The WFS POST handler must be registered');

const req = new EventEmitter();
Object.assign(req, {
  query: { project: 'test-project' },
  originalUrl: '/wfs?project=test-project',
  aborted: false,
  body: `
    <wfs:GetFeature service="WFS" version="1.1.0">
      <wfs:Query typeName="roads">
        <ogc:Filter>
          <ogc:PropertyIsLike wildCard="*" singleChar="." escape="!" matchCase="false">
            <ogc:PropertyName>name</ogc:PropertyName>
            <ogc:Literal>*test*</ogc:Literal>
          </ogc:PropertyIsLike>
        </ogc:Filter>
      </wfs:Query>
    </wfs:GetFeature>`
});

const res = new EventEmitter();
Object.assign(res, {
  statusCode: 200,
  writableFinished: false,
  destroyed: false,
  status(code) {
    this.statusCode = code;
    return this;
  },
  type(contentType) {
    this.contentType = contentType;
    return this;
  },
  setHeader() {},
  send(body) {
    this.body = body;
    this.writableFinished = true;
    return this;
  }
});

await postHandler(req, res);

assert.equal(res.statusCode, 404, 'The worker response should be returned instead of an Express 500');
assert.equal(renderedParams?.action, 'wfs_get_feature');
assert.equal(renderedParams?.filter_expression, 'lower("name") LIKE lower(\'%test%\')');
console.log('WFS XML POST preserves the Express request and applies the search filter.');
