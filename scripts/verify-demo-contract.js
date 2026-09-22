const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const contractPath = path.join(root, 'docs', 'demo', 'demo-contract.json');
const productionEnvPath = path.join(root, '.env.production.example');
const preprodEnvPath = path.join(root, '.env.preproduction.example');

assert.equal(fs.existsSync(contractPath), true, 'demo contract must exist');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

assert.equal(contract.version, 1);
assert.equal(contract.environments.demo.appEnv, 'demo');
assert.equal(contract.environments.demo.web, 'https://demo.somafrik.app');
assert.equal(contract.environments.demo.api, 'https://api-demo.somafrik.app');
assert.equal(contract.environments.demo.databaseIsolationRequired, true);
assert.equal(contract.environments.demo.sharedSecretsForbidden, true);
assert.equal(contract.environments.demo.sharedStorageForbidden, true);
assert.equal(contract.publicEntry, '/demo');
assert.equal(contract.trialRequestRoute, '/demande-essai');
assert.deepEqual(contract.qualification.required, ['profile', 'discoveryRole', 'countryIso']);
assert.equal(contract.qualification.emailRequired, false);
assert.equal(contract.qualification.phoneRequired, false);
assert.equal(contract.session.jwtInUrlForbidden, true);
assert.equal(contract.session.oneTimeCodeRequired, true);
assert.equal(contract.session.platformSuperadminForbidden, true);
assert.equal(contract.web.watermarkRequired, true);
assert.equal(contract.web.noIndex, true);
assert.equal(contract.web.noFollow, true);
assert.equal(contract.web.frameAncestors, 'none');
assert.equal(contract.mobile.sameDemoApiAsWeb, true);
assert.equal(contract.reset.command, 'demo:reset');
assert.equal(contract.reset.productionSeedReuseForbidden, true);

const productionEnv = fs.readFileSync(productionEnvPath, 'utf8');
const preprodEnv = fs.readFileSync(preprodEnvPath, 'utf8');
assert.match(productionEnv, /APP_ENV=production/);
assert.match(preprodEnv, /APP_ENV=preproduction/);
assert.match(productionEnv, /SOMAFRIK_SKIP_DEMO_SEED=true/);
assert.match(preprodEnv, /SOMAFRIK_SKIP_DEMO_SEED=true/);
assert.doesNotMatch(productionEnv, /APP_ENV=demo/);
assert.doesNotMatch(preprodEnv, /APP_ENV=demo/);

console.log('verify-demo-contract: OK');
