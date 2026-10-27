import contextlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('capri_desktop', Path(__file__).parents[1] / 'src/main/linux-desktop.py')
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


class Connection:
    def __init__(self, owner=100):
        self.owner = owner
        self.properties = {'_NET_WM_STATE': [self.intern_atom('_NET_WM_STATE_STICKY')]}
        self.closed = self.synced = False

    def intern_atom(self, name):
        return name

    def create_resource_object(self, kind, xid):
        assert (kind, xid) == ('window', 123)
        return self

    def get_full_property(self, atom, kind):
        if atom == '_NET_WM_PID':
            return types.SimpleNamespace(value=[self.owner])
        value = self.properties.get(atom)
        return types.SimpleNamespace(value=value) if value is not None else None

    def change_property(self, atom, kind, size, values):
        assert kind == 'ATOM' and size == 32
        self.properties[atom] = list(values)

    def sync(self):
        self.synced = True

    def close(self):
        self.closed = True


class OverlayTests(unittest.TestCase):
    def prepare(self, connection, desktop_name):
        xlib = types.SimpleNamespace(Xatom=types.SimpleNamespace(CARDINAL='CARDINAL', ATOM='ATOM'),
                                    display=types.SimpleNamespace(Display=lambda: connection))
        with patch.dict(sys.modules, {'Xlib': xlib}), patch.dict(os.environ, {'XDG_CURRENT_DESKTOP': desktop_name}):
            with contextlib.redirect_stdout(io.StringIO()):
                desktop.prepare_overlay(123, 100)

    def test_kde_uses_fullscreen_overlay_role_and_preserves_input_hints(self):
        connection = Connection()
        self.prepare(connection, 'KDE')
        self.assertEqual(connection.properties['_NET_WM_WINDOW_TYPE'], [
            '_KDE_NET_WM_WINDOW_TYPE_CRITICAL_NOTIFICATION', '_NET_WM_WINDOW_TYPE_NOTIFICATION'])
        self.assertIn('_NET_WM_STATE_STICKY', connection.properties['_NET_WM_STATE'])
        for state in ('SKIP_TASKBAR', 'SKIP_PAGER', 'ABOVE'):
            self.assertIn('_NET_WM_STATE_' + state, connection.properties['_NET_WM_STATE'])
        self.assertNotIn('WM_HINTS', connection.properties)
        self.assertTrue(connection.closed and connection.synced)

    def test_other_desktops_keep_their_original_window_type(self):
        connection = Connection()
        connection.properties['_NET_WM_WINDOW_TYPE'] = ['_NET_WM_WINDOW_TYPE_NORMAL']
        self.prepare(connection, 'XFCE')
        self.assertEqual(connection.properties['_NET_WM_WINDOW_TYPE'], ['_NET_WM_WINDOW_TYPE_NORMAL'])

    def test_foreign_window_is_never_modified(self):
        connection = Connection(owner=999)
        before = dict(connection.properties)
        with self.assertRaisesRegex(RuntimeError, 'not owned by Capri'):
            self.prepare(connection, 'KDE')
        self.assertEqual(connection.properties, before)
        self.assertTrue(connection.closed)


if __name__ == '__main__':
    unittest.main()
