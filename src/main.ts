import { Device, DeviceProvider, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue} from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { connectScryptedClient, ScryptedClientStatic } from '@scrypted/client';
import https from 'https';

const { deviceManager } = sdk;

class ScryptedRemotePlugin extends ScryptedDeviceBase implements DeviceProvider, Settings {
    client: ScryptedClientStatic = null;

    devices = new Map<string, ScryptedDevice>();

    settingsStorage = new StorageSettings(this, {
        baseUrl: {
            title: 'Base URL',
            placeholder: 'https://localhost:10443',
            onPut: async () => await this.clearTryDiscoverDevices(),
        },
        username: {
            title: 'Username',
            onPut: async () => await this.clearTryDiscoverDevices(),
        },
        password: {
            title: 'Password',
            type: 'password',
            onPut: async () => await this.clearTryDiscoverDevices(),
        },
    });

    constructor() {
        super();
        this.clearTryDiscoverDevices();
    }

    /**
     * Checks the given remote device to see if it can be correctly imported by this plugin.
     * Returns the (potentially modified) device that is allowed, or null if the device cannot
     * be imported.
     */
    allowlisted(device: Device): Device {
        // only permit the following interfaces through
        const allowedInterfaces = [
            ScryptedInterface.VideoCamera,
            ScryptedInterface.Camera,
            ScryptedInterface.RTCSignalingChannel,
        ];
        const intersection = allowedInterfaces.filter(i => device.interfaces.includes(i));
        if (intersection.length == 0) {
            return null;
        }
        device.interfaces = intersection;

        return device;
    }

    async clearTryDiscoverDevices(): Promise<void> {
        await this.tryLogin();
        await this.discoverDevices(0);
    }

    async tryLogin(): Promise<void> {
        this.client = null;

        if (!this.settingsStorage.values.baseUrl || !this.settingsStorage.values.username || !this.settingsStorage.values.password) {
            throw new Error("Initializing remote Scrypted login requires the base URL, username, and password");
        }

        const httpsAgent = new https.Agent({
            rejectUnauthorized: false,
        });
        this.client = await connectScryptedClient({
            baseUrl: this.settingsStorage.values.baseUrl,
            pluginId: '@scrypted/core',
            username: this.settingsStorage.values.username,
            password: this.settingsStorage.values.password,
            axiosConfig: {
                httpsAgent,
            },
        })
        this.console.log(`Connected to remote Scrypted server. Remote server version: ${this.client.serverVersion}`)
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }

    async discoverDevices(duration: number): Promise<void> {
        if (!this.client) {
            return
        }

        const state = this.client.systemManager.getSystemState();
        const devices = <Device[]>[];
        for (const id in state) {
            const remoteDevice = this.client.systemManager.getDeviceById(id);
            try {
                // test access
                remoteDevice.nativeId;
            } catch {
                this.console.log(`Cannot access remote device ${id}, ignoring`);
                continue;
            }

            const device = this.allowlisted(<Device>{
                name: remoteDevice.name,
                type: remoteDevice.type,
                interfaces: remoteDevice.interfaces,
                info: remoteDevice.info,
                nativeId: remoteDevice.id,
            });
            if (!device) {
                this.console.log(`Device ${remoteDevice.name} is not supported, ignoring`)
                continue;
            }

            this.console.log(`Found ${remoteDevice.name}\n${JSON.stringify(device, null, 2)}`);
            this.devices.set(device.nativeId, remoteDevice);
            devices.push(device)
        }

        await deviceManager.onDevicesChanged({
            devices,
        });
        this.console.log(`Discovered ${devices.length} devices`);
    }

    async getDevice(nativeId: string): Promise<Device> {
        if (!this.devices.has(nativeId)) {
            throw new Error(`${nativeId} does not exist`)
        }
        return <Device>this.devices.get(nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        this.devices.delete(nativeId)
    }
}

export default new ScryptedRemotePlugin();
