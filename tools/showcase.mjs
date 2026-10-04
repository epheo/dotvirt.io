// Boots dotvirt's own fixture backend on a marketing-grade fleet.
// The scenario and the extra routes live here so the product repo's test
// fixture stays a test fixture.
//
//   DOTVIRT=../dotvirt FIXTURE_PORT=4199 node tools/showcase.mjs
//   (expects `npm run build` done in $DOTVIRT/web)

import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DOTVIRT = path.resolve(process.env.DOTVIRT ?? '../dotvirt');
const fixture = (f) => pathToFileURL(path.join(DOTVIRT, 'web/e2e/fixture', f)).href;

const { scenarios } = await import(fixture('scenarios.mjs'));
const base = scenarios.base;

const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60_000).toISOString();
const unix = Math.floor(now / 1000);

const SIZES = {
	'u1.small': [1, '2Gi'],
	'u1.medium': [2, '4Gi'],
	'u1.large': [4, '8Gi'],
	'u1.xlarge': [8, '16Gi'],
	'm1.xlarge': [8, '32Gi'],
};

function vm(namespace, name, node, ip, over = {}) {
	const size = over.instancetype ?? 'u1.medium';
	const [vcpus, memory] = SIZES[size];
	return {
		namespace,
		name,
		power: 'On',
		instancetype: size,
		preference: 'fedora',
		memory,
		vcpus,
		labels: { app: name.replace(/-\d+$/, '') },
		disks: [{ name: 'rootdisk', type: 'dataVolume', size: '30Gi', storageClass: 'fast-ssd' }],
		networks: [{ name: 'default', network: 'pod', ip, mac: '02:5e:a1:' + mac(ip) }],
		sourceFile: `${namespace}/${name}.yaml`,
		phase: 'Running',
		guestIP: ip,
		ips: [ip],
		nodeName: node,
		os: 'Fedora Linux 42',
		startedAt: iso(60 * 24 * 12 + name.length * 37),
		sync: 'Synced',
		health: 'Healthy',
		...over,
	};
}

const mac = (ip) =>
	ip
		.split('.')
		.slice(1)
		.map((o) => Number(o).toString(16).padStart(2, '0'))
		.join(':');

const off = { power: 'Off', phase: 'Stopped', guestIP: undefined, ips: undefined, nodeName: undefined, startedAt: undefined, os: undefined };
const repo = (name) => `https://git.example.com/dotvirt/${name}.git`;
const synced = (revision) => ({ sync: 'Synced', health: 'Healthy', operation: 'Succeeded', revision });
const apart = (name) => ({ scheduling: { groups: [{ name, mode: 'apart' }] } });
const data = (size, storageClass = 'fast-ssd') => ({ name: 'data', type: 'dataVolume', size, storageClass });
const root = { name: 'rootdisk', type: 'dataVolume', size: '30Gi', storageClass: 'fast-ssd' };

const web = (name, node, n) =>
	vm('web-prod', name, node, `10.20.0.${n}`, {
		...apart('web-tier'),
		networks: [
			{ name: 'default', network: 'pod', ip: `10.20.0.${n}`, mac: `02:5e:a1:14:00:${n.toString(16).padStart(2, '0')}` },
			{ name: 'dmz', network: 'dmz-120', ip: `192.0.2.${n}`, mac: `02:5e:a1:78:00:${n.toString(16).padStart(2, '0')}` },
		],
		ips: [`10.20.0.${n}`, `192.0.2.${n}`],
	});

const projects = [
	{
		name: 'storefront',
		repo: repo('storefront'),
		gitOps: synced('4be91a7'),
		namespaces: [
			{
				namespace: 'web-prod',
				vms: [
					web('web-1', 'worker-2', 11),
					web('web-2', 'worker-3', 12),
					web('web-3', 'worker-4', 13),
					vm('web-prod', 'api-1', 'worker-1', '10.20.0.21', { instancetype: 'u1.large', ...apart('api-tier') }),
					vm('web-prod', 'api-2', 'worker-3', '10.20.0.22', { instancetype: 'u1.large', ...apart('api-tier') }),
				],
			},
			{
				namespace: 'web-staging',
				vms: [
					vm('web-staging', 'web-stg-1', 'worker-4', '10.21.0.11', { instancetype: 'u1.small' }),
					vm('web-staging', 'api-stg-1', '', '', { instancetype: 'u1.small', ...off }),
				],
			},
		],
	},
	{
		name: 'payments',
		repo: repo('payments'),
		gitOps: synced('91c07de'),
		namespaces: [
			{
				namespace: 'payments-prod',
				vms: [
					vm('payments-prod', 'ledger-1', 'worker-1', '10.40.0.11', { instancetype: 'u1.large', evictionStrategy: 'LiveMigrate' }),
					vm('payments-prod', 'ledger-2', 'worker-2', '10.40.0.12', { instancetype: 'u1.large', evictionStrategy: 'LiveMigrate' }),
					vm('payments-prod', 'psp-gateway-1', 'worker-4', '10.40.0.21'),
				],
			},
		],
	},
	{
		name: 'data-platform',
		repo: repo('data-platform'),
		gitOps: synced('d2f6a03'),
		namespaces: [
			{
				namespace: 'db-prod',
				vms: [
					vm('db-prod', 'pg-primary', 'worker-1', '10.30.0.10', { instancetype: 'm1.xlarge', disks: [root, data('400Gi')], drsExclude: true }),
					vm('db-prod', 'pg-replica-1', 'worker-3', '10.30.0.11', { instancetype: 'm1.xlarge', disks: [root, data('400Gi')] }),
					vm('db-prod', 'pg-replica-2', 'worker-4', '10.30.0.12', { instancetype: 'm1.xlarge', disks: [root, data('400Gi')] }),
					vm('db-prod', 'kafka-1', 'worker-2', '10.30.0.31', { instancetype: 'u1.xlarge', disks: [root, data('200Gi', 'bulk-hdd')] }),
					vm('db-prod', 'kafka-2', 'worker-3', '10.30.0.32', { instancetype: 'u1.xlarge', disks: [root, data('200Gi', 'bulk-hdd')] }),
				],
			},
		],
	},
	{
		name: 'build',
		repo: repo('build'),
		gitOps: synced('0a77c1e'),
		namespaces: [
			{
				namespace: 'ci',
				vms: [
					vm('ci', 'runner-1', 'worker-2', '10.50.0.11', { instancetype: 'u1.large', os: 'Debian GNU/Linux 13', preference: 'debian' }),
					vm('ci', 'runner-2', 'worker-4', '10.50.0.12', { instancetype: 'u1.large', os: 'Debian GNU/Linux 13', preference: 'debian' }),
					vm('ci', 'runner-3', '', '', { instancetype: 'u1.large', preference: 'debian', ...off }),
				],
			},
		],
	},
	{
		name: 'erp',
		repo: repo('erp'),
		gitOps: synced('7c3e55b'),
		namespaces: [
			{
				namespace: 'erp-prod',
				vms: [
					vm('erp-prod', 'erp-app-1', 'worker-1', '10.60.0.11', {
						instancetype: 'u1.xlarge',
						os: 'Microsoft Windows Server 2022',
						preference: 'windows.2k22',
						disks: [{ ...root, size: '80Gi' }],
						networks: [
							{ name: 'default', network: 'pod', ip: '10.60.0.11', mac: '02:5e:a1:3c:00:0b' },
							{ name: 'corp', network: 'corp-lan-210', ip: '172.16.210.41', mac: '02:5e:a1:d2:00:29' },
						],
						ips: ['10.60.0.11', '172.16.210.41'],
					}),
					vm('erp-prod', 'erp-db-1', 'worker-2', '10.60.0.12', { instancetype: 'u1.xlarge', disks: [root, data('250Gi')] }),
				],
			},
		],
	},
];

const allVMs = projects.flatMap((p) => p.namespaces.flatMap((n) => n.vms));
const running = allVMs.filter((v) => v.phase === 'Running');

const proposals = [
	{
		project: 'storefront',
		prNumber: 128,
		prURL: 'https://git.example.com/dotvirt/storefront/pulls/128',
		title: 'web tier: add web-4 and pin DNS egress',
		branch: 'dotvirt/proposed/marta/storefront-7c1d',
		by: 'marta',
		checks: 'success',
		approvals: 0,
		requiredApprovals: 1,
	},
	{
		project: 'data-platform',
		prNumber: 57,
		prURL: 'https://git.example.com/dotvirt/data-platform/pulls/57',
		title: 'pg-replica-2: grow the data disk to 600Gi',
		branch: 'dotvirt/proposed/alice/data-platform-2e90',
		by: 'alice',
		mine: true,
		checks: 'pending',
		approvals: 1,
		requiredApprovals: 1,
	},
];

const web3Base = `apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: web-3
  namespace: web-prod
spec:
  runStrategy: Always
  instancetype:
    kind: VirtualMachineClusterInstancetype
    name: u1.medium
  preference:
    kind: VirtualMachineClusterPreference
    name: fedora
  template:
    spec:
      domain:
        devices:
          disks:
            - name: rootdisk
              disk:
                bus: virtio
      volumes:
        - name: rootdisk
          dataVolume:
            name: web-3-rootdisk
`;
const web3Edit = web3Base
	.replace('name: u1.medium', 'name: u1.large')
	.replace(
		'      volumes:\n',
		'            - name: cache\n              disk:\n                bus: virtio\n      volumes:\n',
	)
	.concat('        - name: cache\n          dataVolume:\n            name: web-3-cache\n');

const egressYAML = `apiVersion: k8s.ovn.org/v1
kind: EgressFirewall
metadata:
  name: default
  namespace: web-prod
spec:
  egress:
    - type: Allow
      to:
        cidrSelector: 9.9.9.9/32
      ports:
        - protocol: UDP
          port: 53
    - type: Deny
      to:
        cidrSelector: 0.0.0.0/0
      ports:
        - protocol: UDP
          port: 53
`;

const drafts = {
	storefront: {
		base: 'main',
		branch: 'dotvirt/proposed/alice/storefront',
		items: [
			{
				kind: 'edit',
				namespace: 'web-prod',
				name: 'web-3',
				changes: [
					{ field: 'Instance type', action: 'change', from: 'u1.medium', to: 'u1.large', restart: true },
					{ field: 'Disk', action: 'add', to: 'cache (50Gi, fast-ssd)' },
				],
				yaml: web3Edit,
				baseYAML: web3Base,
			},
			{
				kind: 'create',
				resource: 'egressfirewall',
				namespace: 'web-prod',
				name: 'default',
				changes: [{ field: 'Create gateway firewall', action: 'add', to: 'web-prod/default' }],
				yaml: egressYAML,
			},
		],
	},
};

const commit = (n, hash, title, author, minsAgo, pr) => ({
	hash: hash.padEnd(40, '0'),
	shortHash: hash.slice(0, 8),
	message: pr ? `Merge pull request '${title}' (#${pr}) from dotvirt/proposed/${author}/${n} into main` : title,
	title,
	author,
	when: iso(minsAgo),
	...(pr ? { merge: true, prNumber: pr, prURL: `https://git.example.com/dotvirt/${n}/pulls/${pr}` } : {}),
});

const DAY = 1440;
const history = {
	storefront: [
		commit('storefront', '4be91a7c', 'api tier: spread across hosts', 'alice', 95, 127),
		commit('storefront', 'a3d02f18', 'web-2: add a 50Gi cache disk', 'marta', DAY + 200, 126),
		commit('storefront', '19e6b7d4', 'Allow web to api on TCP 8080', 'alice', 3 * DAY, 124),
		commit('storefront', 'c88f03a1', 'Add api-2', 'jun', 6 * DAY, 121),
		commit('storefront', '5d20e9b6', 'Attach web-prod to dmz-120', 'alice', 9 * DAY, 118),
		commit('storefront', '82ab41ce', 'web-staging: adopt the namespace as it runs', 'marta', 15 * DAY, 112),
		commit('storefront', 'f0137a95', 'dotvirt: seed starter templates', 'dotvirt-bot', 31 * DAY),
		commit('storefront', '0c4e1d22', 'Initial commit', 'dotvirt-bot', 31 * DAY + 1),
	],
};
const historyFor = (project) =>
	history[project] ?? [
		commit(project, '7e11c0d9', 'dotvirt: seed starter templates', 'dotvirt-bot', 31 * DAY),
		commit(project, '31aa9f04', 'Initial commit', 'dotvirt-bot', 31 * DAY + 1),
	];

const gatewayFW = {
	name: 'default',
	kind: 'gateway',
	namespace: 'payments-prod',
	backing: 'EgressFirewall',
	target: 'all pods',
	sourceFile: 'payments-prod/egressfirewalls/default.yaml',
	rules: [
		{ direction: 'Egress', action: 'Allow', peer: '9.9.9.9/32', ports: 'UDP/53' },
		{ direction: 'Egress', action: 'Allow', peer: '198.51.100.0/24', ports: 'TCP/443' },
		{ direction: 'Egress', action: 'Deny', peer: '0.0.0.0/0', ports: '' },
	],
	sync: 'Synced',
};

const dfw = (namespace, name, target, peer, ports) => ({
	name,
	kind: 'dfw',
	namespace,
	backing: 'NetworkPolicy',
	target,
	sourceFile: `${namespace}/networkpolicies/${name}.yaml`,
	rules: [{ direction: 'Ingress', action: 'Allow', peer, ports }],
	sync: 'Synced',
});

const policies = {
	policies: [
		{
			name: 'allow-monitoring',
			kind: 'admin',
			backing: 'AdminNetworkPolicy',
			priority: 5,
			target: 'all namespaces',
			sourceFile: 'cluster/adminnetworkpolicies/allow-monitoring.yaml',
			rules: [{ direction: 'Ingress', action: 'Allow', peer: 'ns: monitoring', ports: 'TCP/9100' }],
			sync: 'Synced',
		},
		{
			name: 'isolate-projects',
			kind: 'admin',
			backing: 'AdminNetworkPolicy',
			priority: 20,
			target: 'all namespaces',
			sourceFile: 'cluster/adminnetworkpolicies/isolate-projects.yaml',
			rules: [
				{ direction: 'Ingress', action: 'Pass', peer: 'same project', ports: '' },
				{ direction: 'Ingress', action: 'Deny', peer: 'any', ports: '' },
			],
			sync: 'Synced',
		},
		dfw('web-prod', 'allow-edge-to-web', 'app=web', 'any', 'TCP/443'),
		dfw('web-prod', 'allow-web-to-api', 'app=api', 'app=web', 'TCP/8080'),
		dfw('db-prod', 'allow-api-to-postgres', 'app=pg', 'ns: web-prod, app=api', 'TCP/5432'),
		dfw('db-prod', 'allow-ledger-to-postgres', 'app=pg', 'ns: payments-prod, app=ledger', 'TCP/5432'),
		dfw('db-prod', 'allow-kafka-clients', 'app=kafka', 'ns: web-prod, payments-prod', 'TCP/9092'),
		dfw('payments-prod', 'allow-api-to-ledger', 'app=ledger', 'ns: web-prod, app=api', 'TCP/8443'),
		gatewayFW,
		{
			name: 'payments-egress',
			kind: 'egressip',
			backing: 'EgressIP',
			target: 'payments-prod',
			namespaces: ['payments-prod'],
			sourceFile: 'cluster/egressips/payments-egress.yaml',
			rules: [{ direction: 'Egress', action: 'SNAT', peer: '203.0.113.24', ports: '' }],
			sync: 'Synced',
		},
	],
};

const segment = (namespace, name, subnet) => ({
	name,
	kind: 'default',
	scope: 'project',
	namespace,
	subnets: [subnet],
	attachRef: `${namespace}/${name}`,
	backing: 'UserDefinedNetwork',
	topology: 'Layer2',
	sourceFile: `${namespace}/networks/${name}.yaml`,
	sync: 'Synced',
});
const vlan = (name, id, namespaces) => ({
	name,
	kind: 'vlan',
	scope: 'shared',
	vlan: id,
	uplink: 'physnet',
	attachRef: name,
	backing: 'ClusterUserDefinedNetwork',
	topology: 'Localnet',
	namespaces,
	sourceFile: `cluster/networks/${name}.yaml`,
	sync: 'Synced',
});

const networks = {
	...base.networks,
	networks: [
		segment('web-prod', 'storefront-net', '10.20.0.0/24'),
		segment('payments-prod', 'payments-net', '10.40.0.0/24'),
		segment('db-prod', 'data-net', '10.30.0.0/24'),
		segment('erp-prod', 'erp-net', '10.60.0.0/24'),
		vlan('dmz-120', 120, ['web-prod']),
		vlan('corp-lan-210', 210, ['erp-prod', 'payments-prod']),
	],
	uplinks: [
		{ name: 'default', bridge: 'br-ex', builtin: true, nodeCount: 4 },
		{
			name: 'physnet',
			bridge: 'br-physnet',
			nodes: ['worker-1', 'worker-2', 'worker-3', 'worker-4'],
			nodeCount: 4,
			ports: ['eno2'],
			status: 'Available',
			sourceFile: 'cluster/uplinks/physnet.yaml',
		},
	],
};

const hosts = [
	['worker-1', 58, 66],
	['worker-2', 47, 52],
	['worker-3', 44, 49],
	['worker-4', 39, 41],
];
const sizeOf = (v) => SIZES[v.instancetype];
const capacity = hosts.map(([node]) => {
	const here = running.filter((v) => v.nodeName === node);
	return {
		node,
		cpuAllocatable: 32,
		vcpuAllocated: here.reduce((s, v) => s + sizeOf(v)[0], 0),
		memAllocatable: 128e9,
		memAllocated: here.reduce((s, v) => s + parseInt(sizeOf(v)[1]) * 2 ** 30, 0),
	};
});
const sum = (k) => capacity.reduce((s, n) => s + n[k], 0);

const top = (names, values) =>
	names.map((name, i) => ({ namespace: allVMs.find((v) => v.name === name).namespace, name, value: values[i] }));

const HOT = ['pg-primary', 'kafka-1', 'api-1', 'runner-1', 'erp-app-1'];

const clusterSummary = {
	updated: unix,
	cpu: { used: 51.6, allocated: sum('vcpuAllocated'), total: 128, spark: [44, 47, 52, 49, 55, 51, 53, 51.6] },
	memory: {
		used: 214e9,
		allocated: sum('memAllocated'),
		total: 512e9,
		spark: [198e9, 203e9, 209e9, 206e9, 211e9, 214e9],
	},
	storage: { used: 1.94e12, total: 6.4e12 },
	vms: { running: running.length, stopped: allVMs.length - running.length },
	// One roster for both lists: the card joins memory onto the CPU rows by name.
	topCpu: top(HOT, [6.4, 5.1, 3.2, 2.9, 2.6]),
	topMemory: top(HOT, [27.4e9, 12.6e9, 6.1e9, 5.4e9, 13.1e9]),
};

const tasks = [
	{ kind: 'op', verb: 'Migrate', namespace: 'db-prod', name: 'kafka-2', project: 'data-platform', by: 'alice', ok: true, at: iso(4) },
	{ kind: 'merge', verb: 'Merged', project: 'storefront', prNumber: 127, prURL: 'https://git.example.com/dotvirt/storefront/pulls/127', title: 'api tier: spread across hosts', by: 'alice', ok: true, at: iso(95) },
	{ kind: 'op', verb: 'Restart', namespace: 'ci', name: 'runner-2', project: 'build', by: 'jun', ok: true, at: iso(140) },
	{ kind: 'merge', verb: 'Merged', project: 'payments', prNumber: 64, prURL: 'https://git.example.com/dotvirt/payments/pulls/64', title: 'Restrict egress to the acquirer range', by: 'marta', ok: true, at: iso(410) },
];

const showcase = {
	...base,
	name: 'showcase',
	user: { username: 'alice', groups: ['platform-admins'] },
	inventory: {
		projects,
		proposals,
		adoptable: [
			{ namespace: 'legacy-billing', vms: 4 },
			{ namespace: 'lab-sandbox', vms: 2 },
		],
		networksVersion: 1,
		tasksVersion: 1,
	},
	tasks,
	alarms: [],
	events: [
		{ namespace: 'db-prod', name: 'kafka-2', type: 'Normal', reason: 'Migrated', message: 'The VirtualMachineInstance migrated to node worker-3.', object: 'VirtualMachineInstance', lastSeen: iso(4) },
		{ namespace: 'web-prod', name: 'web-1', type: 'Normal', reason: 'Started', message: 'VirtualMachineInstance started.', object: 'VirtualMachineInstance', lastSeen: iso(12 * DAY) },
	],
	options: {
		...base.options,
		instancetypes: Object.entries(SIZES).map(([name, [cpu, memory]]) => ({ name, cpu, memory })),
		preferences: [{ name: 'fedora' }, { name: 'debian' }, { name: 'windows.2k22', minCPU: 2, minMemory: '4Gi' }],
		networks: [
			{ name: 'dmz-120', namespace: 'web-prod' },
			{ name: 'corp-lan-210', namespace: 'erp-prod' },
		],
	},
	networks,
	policies,
	nodes: hosts.map(([name]) => ({ name, ready: true })),
	quotas: [
		{
			namespace: 'web-prod',
			name: 'compute',
			items: [
				{ resource: 'requests.cpu', used: 14, hard: 32, unit: 'cores' },
				{ resource: 'requests.memory', used: 28 * 2 ** 30, hard: 96 * 2 ** 30, unit: 'bytes' },
			],
		},
	],
	drs: {
		configured: true,
		config: { mode: 'Automatic', threshold: 'Medium', intervalSeconds: 60, softTainter: true, evictionNodeLimit: 2, evictionTotalLimit: 5 },
		psiConfigured: true,
		live: { apiPresent: true, synced: true, deployed: true, mode: 'Automatic', intervalSeconds: 60, available: true },
		canManage: true,
		canPSI: true,
	},
	permissions: {
		namespace: 'web-prod',
		capabilities: [
			{ id: 'view', label: 'View', allowed: true },
			{ id: 'console', label: 'Open console', allowed: true },
			{ id: 'restart', label: 'Restart', allowed: true },
			{ id: 'migrate', label: 'Live-migrate', allowed: true },
		],
	},
	drafts,
	metrics: {
		...base.metrics,
		clusterSummary,
		hostLoad: {
			updated: unix,
			workers: hosts.length,
			mean: 47,
			nodes: hosts.map(([node, pct, mem]) => ({ node, pct, mem })),
			band: { low: 37, high: 57, above: 1, below: 0 },
		},
		hostCapacity: { updated: unix, nodes: capacity },
	},
};

scenarios.showcase = showcase;

// Routes the test fixture answers too thinly for a screenshot.

const json = (res, body) => {
	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
};

const prItems = {
	128: [
		{
			kind: 'create',
			namespace: 'web-prod',
			name: 'web-4',
			changes: [
				{ field: 'Create VM', action: 'add', to: 'web-prod/web-4' },
				{ field: 'Instance type', action: 'add', to: 'u1.medium' },
				{ field: 'Preference', action: 'add', to: 'fedora' },
			],
			yaml: web3Base.replaceAll('web-3', 'web-4'),
		},
		drafts.storefront.items[1],
	],
	57: [
		{
			kind: 'edit',
			namespace: 'db-prod',
			name: 'pg-replica-2',
			changes: [{ field: 'Disk data', action: 'change', from: '400Gi', to: '600Gi' }],
		},
	],
};

// What the backend proposes for an untitled draft, signed by the session user.
function proposeText(items) {
	const lines = items.flatMap((it) => [
		'',
		`**${it.kind} ${it.namespace}/${it.name}**`,
		...it.changes.map((c) =>
			c.action === 'add' ? `- ${c.field}: + ${c.to}` : `- ${c.field}: ${c.from} -> ${c.to}`,
		),
	]);
	return {
		defaultTitle: `${items.length} changes: ${items.map((it) => it.name).join(', ')}`,
		defaultBody: ['## Changes', ...lines, '', '---', 'Proposed from dotvirt by alice.'].join('\n'),
	};
}

function trace(req) {
	const ip = req.destination?.ip ?? '8.8.8.8';
	const allowed = ip === '9.9.9.9' || ip.startsWith('198.51.100.');
	const rule = allowed ? gatewayFW.rules[ip === '9.9.9.9' ? 0 : 1] : gatewayFW.rules[2];
	const { rules: _, ...policy } = gatewayFW;
	return {
		verdict: allowed ? 'Allow' : 'Deny',
		steps: [
			{
				stage: 'connectivity',
				action: 'Reachable',
				note: `Cluster egress path to ${ip}, evaluated against the source's egress controls.`,
			},
			{
				stage: 'default',
				direction: 'Egress',
				action: 'Allow',
				decisive: true,
				note: 'No policy matches this flow - the network default allows it.',
			},
			{ stage: 'gateway', direction: 'Egress', policy, rule, action: rule.action, decisive: true },
			...(allowed
				? [{ stage: 'snat', direction: 'Egress', policy: policies.policies.at(-1), action: 'SNAT', note: 'Leaves the cluster as 203.0.113.24.' }]
				: []),
		],
	};
}

function effective(ns, name) {
	const bind = (p) => ({ policy: p });
	const mine = policies.policies.filter((p) => p.kind === 'dfw' && p.namespace === ns);
	return {
		namespace: ns,
		vm: name,
		labels: { app: name.replace(/-\d+$/, '') },
		labelsLive: true,
		eastWest: [...policies.policies.filter((p) => p.kind === 'admin'), ...mine].map(bind),
		defaultDenyIngress: mine.length > 0,
		gateway: policies.policies.filter((p) => p.kind === 'gateway' && p.namespace === ns).map(bind),
		snat: policies.policies.filter((p) => p.kind === 'egressip' && p.namespaces?.includes(ns)).map(bind),
	};
}

async function body(req) {
	let data = '';
	for await (const c of req) data += c;
	return data ? JSON.parse(data) : {};
}

async function extra(req, res) {
	const url = new URL(req.url, 'http://localhost');
	const p = url.pathname;
	if (!(req.headers.cookie ?? '').includes('dv_fixture=1')) return false;

	if (p === '/api/networking/trace' && req.method === 'POST') return json(res, trace(await body(req))), true;

	const d = p === '/api/draft' && req.method === 'GET' && drafts[url.searchParams.get('project')];
	if (d) return json(res, { ...d, count: d.items.length, ...proposeText(d.items) }), true;

	let m = p.match(/^\/api\/projects\/([^/]+)\/history$/);
	if (m) return json(res, historyFor(m[1])), true;

	m = p.match(/^\/api\/projects\/([^/]+)\/proposals\/(\d+)$/);
	if (m && prItems[m[2]]) {
		const proposal = proposals.find((x) => x.prNumber === Number(m[2]));
		return json(res, { proposal, items: prItems[m[2]] }), true;
	}

	m = p.match(/^\/api\/vms\/([^/]+)\/([^/]+)\/(policy|history)$/);
	if (m && req.method === 'GET') {
		if (m[3] === 'policy') return json(res, effective(m[1], m[2])), true;
		const all = history.storefront;
		return json(res, m[1] === 'web-prod' ? [all[0], all[3], all.at(-1)] : []), true;
	}

	m = p.match(/^\/api\/namespaces\/([^/]+)\/policy$/);
	if (m) return json(res, effective(m[1])), true;

	return false;
}

// The fixture server builds its own http server at import time; wrapping
// createServer is the only seam that needs no change in the product repo.
const createServer = http.createServer;
http.createServer = (handler) =>
	createServer(async (req, res) => {
		if (req.url.startsWith('/api/') && (await extra(req, res))) return;
		handler(req, res);
	});
syncBuiltinESMExports();

process.env.FIXTURE_SCENARIO = 'showcase';
await import(fixture('server.mjs'));
