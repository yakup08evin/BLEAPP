import {
  StyleSheet,
  Text,
  View,
  PermissionsAndroid,
  FlatList,
  Pressable,
  NativeModules,
  NativeEventEmitter,
  Image,
  Dimensions,
  Platform,
  TouchableHighlight
} from 'react-native';
import BleManager, {
  BleDisconnectPeripheralEvent,
  BleManagerDidUpdateValueForCharacteristicEvent,
  BleScanCallbackType,
  BleScanMatchMode,
  BleScanMode,
  Peripheral,
} from 'react-native-ble-manager';
import React, { useState, useEffect } from 'react';

const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

const SECONDS_TO_SCAN_FOR = 10;
const SERVICE_UUIDS: string[] = [];
const ALLOW_DUPLICATES = true;

const { width, height } = Dimensions.get('window');

export default function App() {
  const [isScanning, setIsScanning] = useState(false);
  const [peripherals, setPeripherals] = useState(new Map<Peripheral['id'], Peripheral>());
  const [messageInterval, setMessageInterval] = useState<NodeJS.Timer | null>(null);

  const addOrUpdatePeripheral = (id: string, updatedPeripheral: Peripheral) => {
    setPeripherals(map => new Map(map.set(id, updatedPeripheral)));
  };

  const startScan = () => {
    if (!isScanning) {
      setPeripherals(new Map<Peripheral['id'], Peripheral>());

      try {
        setIsScanning(true);
        BleManager.scan(SERVICE_UUIDS, SECONDS_TO_SCAN_FOR, ALLOW_DUPLICATES, {
          matchMode: BleScanMatchMode.Sticky,
          scanMode: BleScanMode.LowPower,
          callbackType: BleScanCallbackType.AllMatches,
        })
          .then(() => {
            console.debug('[startScan] scan promise returned successfully.');
          })
          .catch(err => {
            console.error('[startScan] ble scan returned in error', err);
          });
      } catch (error) {
        console.error('[startScan] ble scan error thrown', error);
      }
    }
  };

  const handleStopScan = () => {
    setIsScanning(false);
    console.debug('[handleStopScan] scan is stopped.');
  };

  const handleDisconnectedPeripheral = (event: BleDisconnectPeripheralEvent) => {
    let peripheral = peripherals.get(event.peripheral);
    if (peripheral) {
      addOrUpdatePeripheral(peripheral.id, { ...peripheral, connected: false });
      // Clear message interval when device disconnects
      if (messageInterval) {
        clearInterval(messageInterval);
        setMessageInterval(null);
      }
    }
    console.debug(`[handleDisconnectedPeripheral][${event.peripheral}] disconnected.`);
  };

  const handleUpdateValueForCharacteristic = (data: BleManagerDidUpdateValueForCharacteristicEvent) => {
    console.debug(`[handleUpdateValueForCharacteristic] received data from '${data.peripheral}' with characteristic='${data.characteristic}' and value='${data.value}'`);
  };

  const handleDiscoverPeripheral = (peripheral: Peripheral) => {
    if (!peripheral.name || peripheral.name === 'NO NAME') {
      peripheral.name = 'NO NAME';
    }

    if (peripheral.name !== 'NO NAME') {
      addOrUpdatePeripheral(peripheral.id, peripheral);
    }
  };

  const togglePeripheralConnection = async (peripheral: Peripheral) => {
    if (peripheral && peripheral.connected) {
      try {
        await BleManager.disconnect(peripheral.id);
        addOrUpdatePeripheral(peripheral.id, { ...peripheral, connected: false });
        if (messageInterval) {
          clearInterval(messageInterval);
          setMessageInterval(null);
        }
      } catch (error) {
        console.error(`[togglePeripheralConnection][${peripheral.id}] error when trying to disconnect device.`, error);
      }
    } else {
      await connectPeripheral(peripheral);
    }
  };

  const retrieveConnected = async () => {
    try {
      const connectedPeripherals = await BleManager.getConnectedPeripherals();
      if (connectedPeripherals.length === 0) {
        console.warn('[retrieveConnected] No connected peripherals found.');
        return;
      }

      for (let i = 0; i < connectedPeripherals.length; i++) {
        let peripheral = connectedPeripherals[i];
        addOrUpdatePeripheral(peripheral.id, { ...peripheral, connected: true });
      }
    } catch (error) {
      console.error('[retrieveConnected] unable to retrieve connected peripherals.', error);
    }
  };

  const connectPeripheral = async (peripheral: Peripheral) => {
    try {
      if (peripheral) {
        addOrUpdatePeripheral(peripheral.id, { ...peripheral, connecting: true });
  
        await BleManager.connect(peripheral.id);
        console.debug(`[connectPeripheral][${peripheral.id}] connected.`);
  
        addOrUpdatePeripheral(peripheral.id, {
          ...peripheral,
          connecting: false,
          connected: true,
        });
  
        await sleep(900);
  
        const peripheralData = await BleManager.retrieveServices(peripheral.id);
        console.debug(`[connectPeripheral][${peripheral.id}] retrieved peripheral services`, peripheralData);
  
        // Start sending timestamps every 10 seconds
        const serviceUUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b'; // Replace with your service UUID
        const characteristicUUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8'; // Replace with your characteristic UUID
  
        const intervalId = setInterval(() => {
          const timestamp = Math.floor(Date.now() / 1000); // Get current Unix timestamp in seconds
          const timestampStr = timestamp.toString(); // Convert timestamp to string
          const encodedString = new TextEncoder().encode(timestampStr); // Encode string to Uint8Array
  
          BleManager.write(
            peripheral.id,
            serviceUUID,
            characteristicUUID,
            Array.from(encodedString) // Convert Uint8Array to array for BLE write
          )
            .then(() => console.debug(`[connectPeripheral][${peripheral.id}] sent timestamp: ${timestampStr}.`))
            .catch(error => console.error(`[connectPeripheral][${peripheral.id}] failed to send timestamp.`, error));
        }, 10000);
  
        setMessageInterval(intervalId);
      }
    } catch (error) {
      console.error(`[connectPeripheral][${peripheral.id}] connectPeripheral error`, error);
    }
  };
  
  

  function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
  }

  useEffect(() => {
    try {
      BleManager.start({ showAlert: false })
        .then(() => console.debug('BleManager started.'))
        .catch(error => console.error('BeManager could not be started.', error));
    } catch (error) {
      console.error('unexpected error starting BleManager.', error);
      return;
    }

    const listeners = [
      bleManagerEmitter.addListener('BleManagerDiscoverPeripheral', handleDiscoverPeripheral),
      bleManagerEmitter.addListener('BleManagerStopScan', handleStopScan),
      bleManagerEmitter.addListener('BleManagerDisconnectPeripheral', handleDisconnectedPeripheral),
      bleManagerEmitter.addListener('BleManagerDidUpdateValueForCharacteristic', handleUpdateValueForCharacteristic),
    ];

    handleAndroidPermissions();

    return () => {
      console.debug('[app] main component unmounting. Removing listeners...');
      for (const listener of listeners) {
        listener.remove();
      }
    };
  }, []);

  const handleAndroidPermissions = () => {
    if (Platform.OS === 'android' && Platform.Version >= 31) {
      PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]).then(result => {
        if (result) {
          console.debug('[handleAndroidPermissions] User accepts runtime permissions android 12+');
        } else {
          console.error('[handleAndroidPermissions] User refuses runtime permissions android 12+');
        }
      });
    } else if (Platform.OS === 'android' && Platform.Version >= 23) {
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION).then(checkResult => {
        if (checkResult) {
          console.debug('[handleAndroidPermissions] runtime permission Android <12 already OK');
        } else {
          PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION).then(requestResult => {
            if (requestResult) {
              console.debug('[handleAndroidPermissions] User accepts runtime permission android <12');
            } else {
              console.error('[handleAndroidPermissions] User refuses runtime permission android <12');
            }
          });
        }
      });
    }
  };

  const renderItem = ({ item }: { item: Peripheral }) => {
    if (item.name === 'NO NAME') {
      return null; // Filter out "NO NAME" devices
    }

    const backgroundColor = item.connected ? 'orange' : 'gray';
    return (
      <TouchableHighlight
        underlayColor="#0082FC"
        onPress={() => togglePeripheralConnection(item)}>
        <View style={[styles.row, { backgroundColor }]}>
          <Text style={styles.peripheralName}>
            {item.name} - {item?.advertising?.localName}
            {item.connecting && ' - Connecting...'}
          </Text>
          <Text style={styles.rssi}>RSSI: {item.rssi}</Text>
          <Text style={styles.peripheralId}>{item.id}</Text>
        </View>
      </TouchableHighlight>
    );
  };

  return (
    <View style={styles.container}>
      <View>
        <Image style={styles.GesLogo} source={require('./assets/ges.png')} />
        <Pressable style={styles.scanButton} onPress={startScan}>
          <Text style={styles.scanButtonText}>
            {isScanning ? 'Scanning...' : 'Scan Bluetooth'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.devicesTitle}> Available Devices</Text>
      <FlatList
        style={styles.flat}
        data={Array.from(peripherals.values()).filter(p => p.name !== 'NO NAME')} // Filter out "NO NAME" devices
        contentContainerStyle={{ rowGap: 12 }}
        renderItem={renderItem}
        keyExtractor={item => item.id}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'yellow',
  },
  scanButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    backgroundColor: 'black',
    borderRadius: 15,
    margin: 30
  },
  scanButtonText: {
    fontSize: 20,
    letterSpacing: 0.25,
    color: 'white',
    fontWeight: 'bold'
  },
  GesLogo: {
    borderRadius: 5,
    width: width * 0.9,
    height: height * 0.15,
    backgroundColor: 'yellow',
    marginTop: 35,
  },
  peripheralName: {
    fontSize: 25,
    textAlign: 'center',
    padding: 10,
    color: 'white',
    fontWeight: 'bold'
  },
  rssi: {
    fontSize: 20,
    textAlign: 'center',
    color: 'white',
    fontWeight: 'bold'
  },
  peripheralId: {
    fontSize: 20,
    textAlign: 'center',
    paddingBottom: 20,
    fontWeight: 'bold'
  },
  row: {
    borderRadius: 5,
  },
  flat: {
    backgroundColor: 'white',
    width: width,
    borderRadius: 0,
    padding: 10,
    textAlign: 'center',
    margin: 0,
  },
  devicesTitle: {
    fontSize: 35,
    width: width,
    textAlign: 'center',
    padding: 10,
    color: 'white',
    fontWeight: 'bold',
    backgroundColor: 'black',
  }
});
