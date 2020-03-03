/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { ConnectionService, IConnectionProvider, IProviderConnectionCompleteEvent, IProviderConnectionChangedEvent, ConnectionState, IConnection } from 'sql/platform/connection/common/connectionService';
import { Emitter, Event } from 'vs/base/common/event';
import { ConnectionProviderProperties } from 'sql/platform/capabilities/common/capabilitiesService';
import { ConnectionOptionSpecialType, ServiceOptionType } from 'sql/platform/connection/common/interfaces';
import { CapabilitiesService } from 'sql/platform/capabilities/common/capabilitiesServiceImpl';
import { isUndefined } from 'vs/base/common/types';
import { setImmediate } from 'vs/base/common/platform';

const basicOptions: { [key: string]: any } = {
	serverName: 'testServer',
	databaseName: 'testdatabase',
	userName: 'testuser',
	password: 'testpassword'
};

suite('Connection Service', () => {
	test('does connect', async () => {
		const [connectionService, provider] = createService();
		const connectStub = sinon.stub(provider, 'connect', (connectionUri: string, options: { [name: string]: any; }) => {
			assert.deepStrictEqual(basicOptions, options);
			setImmediate(() => provider.onDidConnectionCompleteEmitter.fire({ connectionUri }));
			return Promise.resolve(true);
		});

		const connection = connectionService.createOrGetConnection('someuri', { provider: TestConnectionProvider.ID, options: basicOptions });
		assert(connection.provider === TestConnectionProvider.ID);
		assert(connection.state === ConnectionState.DISCONNECTED);
		const result = await connection.connect();
		assert(!result.failed);
		assert(isUndefined(result.errorMessage));
		assert(connectStub.calledOnce);
	});

	test('does provide onDidConnect promise', async () => {
		const [connectionService, provider] = createService();
		const connectStub = sinon.stub(provider, 'connect', (connectionUri: string, options: { [name: string]: any; }) => {
			setImmediate(() => provider.onDidConnectionCompleteEmitter.fire({ connectionUri }));
			return Promise.resolve(true);
		});

		const connection = connectionService.createOrGetConnection('someuri', { provider: TestConnectionProvider.ID, options: basicOptions });
		assert(connection.state === ConnectionState.DISCONNECTED);
		connection.connect();

		const result = await connection.onDidConnect;
		assert(!result.failed);
		assert(isUndefined(result.errorMessage));
		assert(connectStub.calledOnce);
	});

	test('does listen for extensions being installed', async () => {
		const [connectionService, , capabilitiesService] = createService();
		capabilitiesService.registerConnectionProvider('testProvider2', TestConnectionProvider.properties);
		const provider = new TestConnectionProvider();
		sinon.stub(provider, 'id', { get: () => 'testProvider2' });
		connectionService.registerProvider(provider);

		const connectStub = sinon.stub(provider, 'connect', (connectionUri: string, options: { [name: string]: any; }) => {
			setImmediate(() => provider.onDidConnectionCompleteEmitter.fire({ connectionUri }));
			return Promise.resolve(true);
		});

		const connection = connectionService.createOrGetConnection('someuri', { provider: 'testProvider2', options: basicOptions });
		assert(connection.provider === 'testProvider2');
		assert(connection.state === ConnectionState.DISCONNECTED);
		connection.connect();

		const result = await connection.onDidConnect;
		assert(!result.failed);
		assert(isUndefined(result.errorMessage));
		assert(connectStub.calledOnce);
	});

	test('does listen for extensions being uninstalled', async () => {
		const [connectionService, , capabilitiesService] = createService();

		const disposable = capabilitiesService.registerConnectionProvider('testProvider2', TestConnectionProvider.properties);
		const provider = new TestConnectionProvider();
		sinon.stub(provider, 'id', { get: () => 'testProvider2' });
		connectionService.registerProvider(provider);

		disposable.dispose();

		assert.throws(() => connectionService.createOrGetConnection('someuri', { provider: 'testProvider2', options: basicOptions }));
	});

	test('returns early if inital connection attempt fails', async () => {
		const [connectionService, provider] = createService();

		sinon.stub(provider, 'connect', (connectionUri: string, options: { [name: string]: any; }) => {
			return Promise.resolve(false);
		});

		const connection = connectionService.createOrGetConnection('someuri', { provider: TestConnectionProvider.ID, options: basicOptions });
		assert(connection.state === ConnectionState.DISCONNECTED);
		const result = await connection.connect();
		assert(result.failed);
		assert(connection.state === ConnectionState.DISCONNECTED);
	});

	test('corrects connection state if connection fails', async () => {
		const [connectionService, provider] = createService();
		const errorMessage = 'some random error message';
		const connectStub = sinon.stub(provider, 'connect', (connectionUri: string, options: { [name: string]: any; }) => {
			setImmediate(() => provider.onDidConnectionCompleteEmitter.fire({ connectionUri, errorMessage }));
			return Promise.resolve(true);
		});

		const connection = connectionService.createOrGetConnection('someuri', { provider: TestConnectionProvider.ID, options: basicOptions });
		assert(connection.state === ConnectionState.DISCONNECTED);
		const result = await connection.connect();

		assert(result.failed);
		assert(result.errorMessage === errorMessage);
		assert(connection.state === ConnectionState.DISCONNECTED);
		assert(connectStub.calledOnce);
	});

	test('does return if you connect an already connecting connection', async () => {
		const [connectionService, provider] = createService();
		const connectStub = sinon.stub(provider, 'connect', (connectionUri: string, options: { [name: string]: any; }) => {
			setImmediate(() => provider.onDidConnectionCompleteEmitter.fire({ connectionUri }));
			return Promise.resolve(true);
		});

		const connection = connectionService.createOrGetConnection('someuri', { provider: TestConnectionProvider.ID, options: basicOptions });
		assert(connection.state === ConnectionState.DISCONNECTED);
		const original = connection.connect();
		const second = await connection.connect();
		const result = await original;

		assert.deepEqual(result, second);

		assert(!result.failed);
		assert(isUndefined(result.errorMessage));
		assert(connection.state === ConnectionState.CONNECTED);
		assert(connectStub.calledOnce);
	});

	test('does return if you connect an already connected connection', async () => {
		const [connectionService, provider] = createService();
		const connectStub = sinon.stub(provider, 'connect', (connectionUri: string, options: { [name: string]: any; }) => {
			setImmediate(() => provider.onDidConnectionCompleteEmitter.fire({ connectionUri }));
			return Promise.resolve(true);
		});

		const connection = connectionService.createOrGetConnection('someuri', { provider: TestConnectionProvider.ID, options: basicOptions });
		assert(connection.state === ConnectionState.DISCONNECTED);
		const result = await connection.connect();
		assert(!result.failed);
		assert(isUndefined(result.errorMessage));
		assert(connection.state === ConnectionState.CONNECTED);

		const second = await connection.connect();

		assert.deepEqual(result, second);

		assert(connectStub.calledOnce);
	});

	test('does return existing connection if exists', async () => {
		const [connectionService] = createService();
		const connection1 = connectionService.createOrGetConnection('someuri', { provider: TestConnectionProvider.ID, options: basicOptions });
		const connection2 = connectionService.createOrGetConnection('someuri', { provider: TestConnectionProvider.ID, options: basicOptions });

		assert.strictEqual(connection1, connection2);
	});

	test('does return different connections for different uris', async () => {
		const [connectionService] = createService();
		const connection1 = connectionService.createOrGetConnection('someuri', { provider: TestConnectionProvider.ID, options: basicOptions });
		const connection2 = connectionService.createOrGetConnection('someuri2', { provider: TestConnectionProvider.ID, options: basicOptions });

		assert.notStrictEqual(connection1, connection2);
	});

	test('does return proper id for connection', async () => {
		const [connectionService] = createService();
		const connection1 = connectionService.createOrGetConnection('someuri', { provider: TestConnectionProvider.ID, options: basicOptions });

		assert(connectionService.getIdForConnection(connection1), 'someuri');
	});

	test('does throw if connection for id is not actually a connection', () => {
		const [connectionService] = createService();
		const fakeConnection: IConnection = {
			state: ConnectionState.CONNECTED,
			connect: () => Promise.resolve({ failed: false }),
			disconnect: () => Promise.resolve(),
			onDidConnect: Promise.resolve({ failed: false }),
			onDidStateChange: Event.None,
			provider: 'provider'
		};
		assert.throws(() => connectionService.getIdForConnection(fakeConnection));
	});

	test('does disconnect properly', async () => {
		const [connectionService, provider] = createService();
		const disconnectStub = sinon.stub(provider, 'disconnect', (): Promise<boolean> => Promise.resolve(true));

		const connection1 = connectionService.createOrGetConnection('someuri', { provider: TestConnectionProvider.ID, options: basicOptions });
		await connection1.connect();

		assert(connection1.state === ConnectionState.CONNECTED);

		await connection1.disconnect();

		assert(disconnectStub.calledOnce);
		assert(connection1.state === ConnectionState.DISCONNECTED);
	});
});

function createService(): [ConnectionService, TestConnectionProvider, CapabilitiesService] {
	const capabilitiesService = new CapabilitiesService();
	const provider = new TestConnectionProvider();
	capabilitiesService.registerConnectionProvider(TestConnectionProvider.ID, TestConnectionProvider.properties);
	const connectionService = new ConnectionService(capabilitiesService);
	connectionService.registerProvider(provider);
	return [connectionService, provider, capabilitiesService];
}

class TestConnectionProvider implements IConnectionProvider {
	public static readonly ID = 'testConnectionProvider';
	public static readonly properties: ConnectionProviderProperties = {
		providerId: TestConnectionProvider.ID,
		displayName: 'Test Provider',
		connectionOptions: [
			{
				specialValueType: ConnectionOptionSpecialType.serverName,
				name: 'serverName',
				groupName: 'source',
				isRequired: true,
				valueType: ServiceOptionType.string,
				displayName: 'serverName',
				description: 'serverName',
				isIdentity: true
			},
			{
				specialValueType: ConnectionOptionSpecialType.databaseName,
				name: 'databaseName',
				groupName: 'source',
				isRequired: true,
				valueType: ServiceOptionType.string,
				displayName: 'databaseName',
				description: 'databaseName',
				isIdentity: true
			},
			{
				specialValueType: ConnectionOptionSpecialType.userName,
				name: 'userName',
				groupName: 'source',
				isRequired: true,
				valueType: ServiceOptionType.string,
				displayName: 'userName',
				description: 'userName',
				isIdentity: true
			},
			{
				specialValueType: ConnectionOptionSpecialType.password,
				name: 'password',
				groupName: 'source',
				isRequired: true,
				valueType: ServiceOptionType.string,
				displayName: 'password',
				description: 'password',
				isIdentity: true
			}
		]
	};

	public get id() { return TestConnectionProvider.ID; }

	public readonly onDidConnectionCompleteEmitter = new Emitter<IProviderConnectionCompleteEvent>();
	public readonly onDidConnectionComplete = this.onDidConnectionCompleteEmitter.event;

	public readonly onDidConnectionChangedEmitter = new Emitter<IProviderConnectionChangedEvent>();
	public readonly onDidConnectionChanged = this.onDidConnectionChangedEmitter.event;

	connect(connectionUri: string, options: { [name: string]: any; }): Promise<boolean> {
		setImmediate(() => this.onDidConnectionCompleteEmitter.fire({ connectionUri }));
		return Promise.resolve(true);
	}

	disconnect(connectionUri: string): Promise<boolean> {
		return Promise.resolve(true);
	}

	cancelConnect(connectionUri: string): Promise<boolean> {
		return Promise.resolve(true);
	}
}