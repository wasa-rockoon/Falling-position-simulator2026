import os
import sys
import tempfile
import types
import unittest
sys.path.insert(0, os.path.dirname(__file__))
sys.modules['tawhiri.dataset'] = types.SimpleNamespace(Dataset=types.SimpleNamespace(size=16, axes=types.SimpleNamespace(hour=[0, 192])))
import weather_store

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = self.temp.name
        self.data = os.path.join(self.base, 'tawhiri-datasets')
        os.mkdir(self.data)
        self.write('2026090600', b'x' * 16)
        self.write('2026090600.gribmirror', b'mirror')
        with open(os.path.join(self.base, 'ruaumoko-dataset'), 'wb') as stream:
            stream.write(b'terrain-preserved')
    def tearDown(self):
        self.temp.cleanup()
    def write(self, name, data):
        with open(os.path.join(self.data, name), 'wb') as stream:
            stream.write(data)
    def test_delete_run_preserves_elevation_and_unrelated_files(self):
        self.write('2026090700', b'y'*16)
        row = [r for r in weather_store.inventory(self.base)['datasets'] if r['run']=='2026090600'][0]
        result = weather_store.delete('delete-run', row['run'], row['fingerprint'], self.base)
        self.assertEqual(set(result['deleted']), {'2026090600','2026090600.gribmirror'})
        self.assertTrue(os.path.exists(os.path.join(self.data,'2026090700')))
        self.assertTrue(os.path.exists(os.path.join(self.base,'ruaumoko-dataset')))
    def test_stale_confirmation_rejects_changed_file(self):
        row = weather_store.inventory(self.base)['datasets'][0]
        self.write('2026090600', b'new')
        with self.assertRaises(ValueError):
            weather_store.delete('delete-run', row['run'], row['fingerprint'], self.base)
        self.assertTrue(os.path.exists(os.path.join(self.data,'2026090600')))
    def test_symlink_and_traversal_are_never_deletion_targets(self):
        os.symlink(os.path.join(self.base,'ruaumoko-dataset'), os.path.join(self.data,'2026090700'))
        self.assertEqual(len(weather_store.inventory(self.base)['datasets']),1)
        for value in ['../ruaumoko-dataset','2026090700','2026023000']:
            with self.assertRaises(ValueError):
                weather_store.delete('delete-run',value,'x',self.base)
    def test_cleanup_only_recognized_incomplete_files(self):
        self.write('download-2026090700',b'partial')
        self.write('keep-me',b'not-a-dataset')
        row = weather_store.inventory(self.base)['temporary'][0]
        weather_store.delete('cleanup',row['name'],row['fingerprint'],self.base)
        self.assertTrue(os.path.exists(os.path.join(self.data,'keep-me')))
        with self.assertRaises(ValueError):
            weather_store.delete('cleanup','keep-me','x',self.base)

if __name__ == '__main__':
    unittest.main()
