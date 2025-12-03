#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const LICENSE_TEXT = `QtilerAuth Commercial License
Version 1.0 · December 3, 2025

1. Grant of License
MundoGIS AB ("Licensor") grants the purchasing customer ("Licensee") a non-exclusive, non-transferable, royalty-free license to install and use the QtilerAuth plugin ("Software") solely within a single Qtiler deployment operated by the Licensee or its wholly owned subsidiaries.

2. Permitted Use
Licensee may:
  a. Run the Software on production and staging instances that belong to the same deployment environment.
  b. Modify configuration files delivered with the Software when necessary for integration with Licensee infrastructure.
  c. Make a reasonable number of backup copies for disaster recovery, provided all proprietary notices remain intact.

3. Restrictions
Licensee may not:
  a. Distribute, sublicense, lease, sell, or otherwise transfer the Software to any third party without prior written approval from Licensor.
  b. Publish or disclose the source code, license keys, or proprietary implementation details to any third party.
  c. Use the Software to provide commercial hosting or "software as a service" offerings for unaffiliated third parties.
  d. Remove or obscure copyright notices or references to this License.

4. Ownership
Licensor retains all right, title, and interest in and to the Software, including all intellectual property rights. This License conveys only the limited rights expressly stated herein.

5. Support & Updates
Unless covered by a separate support agreement, Licensor provides the Software "as is" without obligation to deliver updates, patches, or new features. Licensee may purchase premium maintenance directly from Licensor.

6. Limited Warranty
Licensor warrants that it has the right to grant this License. To the maximum extent permitted by law, the Software is provided "as is" without warranties of merchantability or fitness for a particular purpose.

7. Limitation of Liability
In no event shall Licensor be liable for any indirect, special, incidental, or consequential damages arising out of the use of or inability to use the Software. Licensor's aggregate liability shall not exceed the amount paid by Licensee for the Software.

8. Termination
This License remains in effect until terminated. Licensor may terminate the License if Licensee materially breaches its terms and fails to cure within 15 days of written notice. Upon termination, Licensee must cease all use of the Software and destroy all copies in its possession.

9. Governing Law & Dispute Resolution
This License is governed by the laws of Sweden, without regard to conflict-of-law principles. Any dispute shall be submitted to the competent courts of Gothenburg, Sweden.

10. Contact
For licensing questions, contact MundoGIS AB · abel.gonzalez@mundogis.se · +46 31 123 456.
`;

const DEFAULT_TARGET = path.join(repoRoot, 'plugins', 'QtilerAuth', 'LICENSE_QtilerAuth.txt');
const TEMP_ZIP_TARGET = path.join(repoRoot, 'temp_zip', 'LICENSE_QtilerAuth.txt');

const args = process.argv.slice(2);
const manualTargets = [];
let mirrorTemp = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    printHelp();
  } else if (arg === '--out') {
    const next = args[i + 1];
    if (!next) {
      console.error('Error: --out requires a path argument.');
      process.exit(1);
    }
    manualTargets.push(resolveTarget(next));
    i += 1;
  } else if (arg === '--mirror-temp') {
    mirrorTemp = true;
  } else {
    console.error(`Unknown argument: ${arg}`);
    printHelp(1);
  }
}

const targets = manualTargets.length ? [...manualTargets] : [DEFAULT_TARGET];
if (mirrorTemp) {
  targets.push(TEMP_ZIP_TARGET);
}

writeLicenseFiles([...new Set(targets)]);

function resolveTarget(value) {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

function writeLicenseFiles(list) {
  list.forEach((targetPath) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, LICENSE_TEXT, 'utf8');
    console.log(`Wrote QtilerAuth license to ${targetPath}`);
  });
}

function printHelp(exitCode = 0) {
  console.log(`Usage: node tools/generate-qtilerauth-license.js [options]

Options:
  --out <path>       Write the license to an additional path (repeatable)
  --mirror-temp      Also write to temp_zip/LICENSE_QtilerAuth.txt
  -h, --help         Show this help message
`);
  process.exit(exitCode);
}
