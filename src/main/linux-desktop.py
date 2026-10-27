#!/usr/bin/env python3
"""KWin 6 / X11 geometry bridge. JSON lines on stdout; commands on stdin.

No screenshots or window titles are sent to Capri. The temporary KWin script is
loaded for this process only and unloaded on exit. No desktop settings are changed.
"""
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import time


def emit(data):
    print(json.dumps(data, separators=(',', ':')), flush=True)


def prepare_overlay(window_id, parent_pid):
    """Set the overlay's role before KWin manages it, retaining keyboard focus.

    KWin puts active fullscreen clients above ordinary keep-above windows. Its
    critical-notification role is above that layer, with normal input hints.
    These are properties of our own window, not persistent compositor rules.
    """
    from Xlib import Xatom, display
    connection = display.Display()
    try:
        window = connection.create_resource_object('window', window_id)
        owner = window.get_full_property(connection.intern_atom('_NET_WM_PID'), Xatom.CARDINAL)
        if owner is None or len(owner.value) != 1 or int(owner.value[0]) != parent_pid:
            raise RuntimeError('Refusing to change a window not owned by Capri')
        kde = 'KDE' in os.environ.get('XDG_CURRENT_DESKTOP', '').upper()
        if kde:
            window.change_property(connection.intern_atom('_NET_WM_WINDOW_TYPE'), Xatom.ATOM, 32, [
                connection.intern_atom('_KDE_NET_WM_WINDOW_TYPE_CRITICAL_NOTIFICATION'),
                connection.intern_atom('_NET_WM_WINDOW_TYPE_NOTIFICATION'),
            ])
        state_atom = connection.intern_atom('_NET_WM_STATE')
        previous = window.get_full_property(state_atom, Xatom.ATOM)
        states = list(previous.value) if previous is not None else []
        for name in ('_NET_WM_STATE_SKIP_TASKBAR', '_NET_WM_STATE_SKIP_PAGER', '_NET_WM_STATE_ABOVE'):
            value = connection.intern_atom(name)
            if value not in states:
                states.append(value)
        window.change_property(state_atom, Xatom.ATOM, 32, states)
        # Do not set override_redirect or disable WM_HINTS.input: chat needs focus.
        connection.sync()
        emit({'ok': True, 'role': 'critical-notification' if kde else 'unchanged'})
    finally:
        connection.close()


def kwin(parent_pid, window_id):
    import dbus
    import dbus.service
    from dbus.mainloop.glib import DBusGMainLoop
    from gi.repository import GLib
    from linux_input import InputRegions

    DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    owner = bus.get_name_owner('org.kde.KWin')
    name = 'org.capri.Desktop.p' + str(os.getpid())
    bus_name = dbus.service.BusName(name, bus=bus)
    commands = []
    last = None
    loop = GLib.MainLoop()
    input_regions = InputRegions.open(window_id, parent_pid)
    input_timer = GLib.timeout_add(50, input_regions.tick)
    stdin_buffer = ''

    class Bridge(dbus.service.Object):
        @dbus.service.method('org.capri.Desktop', in_signature='s', out_signature='s',
                             async_callbacks=('reply', 'error'), sender_keyword='sender')
        def Snapshot(self, payload, reply, error, sender=None):
            nonlocal last
            if sender != owner or len(payload) > 256 * 1024:
                error(dbus.exceptions.DBusException('Unexpected snapshot sender or size'))
                return
            try:
                data = json.loads(payload)
                data['input'] = {'mode': 'shaped', 'rectangles': input_regions.count}
                if payload != last:
                    emit(data)
                    last = payload
            except (ValueError, TypeError) as exc:
                error(dbus.exceptions.DBusException(str(exc)))
                return

            def respond():
                reply(json.dumps(commands))
                commands.clear()
                return False
            GLib.timeout_add(50, respond)

    bridge = Bridge(bus_name, '/Capri')
    manager = dbus.Interface(bus.get_object('org.kde.KWin', '/Scripting'), 'org.kde.kwin.Scripting')
    plugin = 'capri-session-' + str(os.getpid())
    with tempfile.TemporaryDirectory(prefix='capri-kwin-') as tmp:
        script = Path(tmp) / 'main.js'
        source = Path(__file__).with_name('kwin.js').read_text()
        script.write_text(source.replace('__CAPRI_BUS__', name).replace('__CAPRI_PID__', str(parent_pid)))
        # Qt exports both loadScript(s) and loadScript(ss). dbus-python caches
        # one introspection signature per name, so select this overload explicitly.
        script_id = int(manager.loadScript(str(script), plugin, signature='ss'))
        if script_id < 0:
            raise RuntimeError('KWin refused to load the Capri geometry script')
        try:
            dbus.Interface(bus.get_object('org.kde.KWin', '/Scripting/Script' + str(script_id)),
                           'org.kde.kwin.Script').run()

            def stdin_ready(source, condition):
                nonlocal stdin_buffer
                if condition & (GLib.IO_HUP | GLib.IO_ERR):
                    loop.quit()
                    return False
                chunk = os.read(sys.stdin.fileno(), 65536)
                if not chunk:
                    loop.quit()
                    return False
                stdin_buffer += chunk.decode('utf8')
                while '\n' in stdin_buffer:
                    line, stdin_buffer = stdin_buffer.split('\n', 1)
                    try:
                        cmd = json.loads(line)
                        if cmd.get('command') == 'close' and isinstance(cmd.get('ids'), list):
                            commands.append({'command': 'close', 'ids': [str(i) for i in cmd['ids']][:100]})
                        elif cmd.get('command') == 'input-regions':
                            input_regions.refresh(cmd.get('rects'), cmd.get('viewport'))
                    except (ValueError, AttributeError):
                        pass
                return True

            GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, stdin_ready)

            def alive():
                if os.getppid() != parent_pid or not bus.name_has_owner('org.kde.KWin'):
                    loop.quit()
                    return False
                return True
            GLib.timeout_add_seconds(2, alive)
            for sig in (signal.SIGTERM, signal.SIGINT):
                GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, lambda: (loop.quit(), False)[1])
            loop.run()
        finally:
            GLib.source_remove(input_timer)
            input_regions.close()
            try:
                manager.unloadScript(plugin)
            except dbus.DBusException:
                pass
            bridge.remove_from_connection()


def x11(parent_pid, window_id):
    import re
    from Xlib import X, display, protocol
    from linux_input import InputRegions
    input_regions = InputRegions.open(window_id, parent_pid)
    stdin_buffer = ''
    d = display.Display()
    root = d.screen().root
    atoms = {}

    def prop(w, name, default=None):
        atom = atoms.setdefault(name, d.intern_atom(name))
        try:
            value = w.get_full_property(atom, X.AnyPropertyType)
            return value.value if value is not None else default
        except Exception:
            return default

    def number(w, name, default=0):
        values = prop(w, name, [])
        return int(values[0]) if len(values) else default

    last = None
    while os.getppid() == parent_pid:
        desktop = number(root, '_NET_CURRENT_DESKTOP')
        active = number(root, '_NET_ACTIVE_WINDOW')
        wins = []
        ids = prop(root, '_NET_CLIENT_LIST_STACKING', [])
        for wid in reversed(ids):
            try:
                w = d.create_resource_object('window', int(wid))
                pid = number(w, '_NET_WM_PID')
                if (pid == parent_pid and w.get_wm_name() == 'Capri Desktop Overlay') or w.get_attributes().map_state != X.IsViewable:
                    continue
                if number(w, '_NET_WM_DESKTOP', desktop) not in (desktop, 0xffffffff):
                    continue
                types = prop(w, '_NET_WM_WINDOW_TYPE', [])
                if any(d.intern_atom(t) in types for t in ('_NET_WM_WINDOW_TYPE_DESKTOP', '_NET_WM_WINDOW_TYPE_DOCK')):
                    continue
                geo = w.get_geometry()
                pos = root.translate_coords(w, 0, 0)
                ext = prop(w, '_NET_FRAME_EXTENTS', [0, 0, 0, 0])
                if geo.width < 200 or geo.height < 120:
                    continue
                state = prop(w, '_NET_WM_STATE', [])
                maximized = all(d.intern_atom(t) in state for t in
                                ('_NET_WM_STATE_MAXIMIZED_VERT', '_NET_WM_STATE_MAXIMIZED_HORZ'))
                cls = w.get_wm_class() or ('', '')
                wins.append({'id': int(wid), 'x': pos.x - int(ext[0]), 'y': pos.y - int(ext[2]),
                             'w': geo.width + int(ext[0]) + int(ext[1]),
                             'h': geo.height + int(ext[2]) + int(ext[3]),
                             'max': maximized or d.intern_atom('_NET_WM_STATE_FULLSCREEN') in state,
                             'pid': pid, 'app': cls[-1]})
            except Exception:
                continue
        ai = []
        taskbar = False
        if active:
            try:
                fg = d.create_resource_object('window', active)
                title = prop(fg, '_NET_WM_NAME', b'')
                if hasattr(title, 'tobytes'):
                    title = title.tobytes()
                if isinstance(title, bytes):
                    title = title.decode('utf8', errors='replace')
                title = str(title) + ' ' + ' '.join(fg.get_wm_class() or [])
                rivals = [('chatgpt', r'\bChatGPT\b'), ('claude', r'\bClaude\b'), ('codex', r'\bCodex\b'),
                          ('gemini', r'\bGemini\b'), ('copilot', r'\bCopilot\b'), ('perplexity', r'\bPerplexity\b'),
                          ('deepseek', r'\bDeepSeek\b'), ('grok', r'\bGrok\b'), ('lechat', r'\bLe Chat\b|\bMistral AI\b'),
                          ('characterai', r'character\.ai'), ('metaai', r'\bMeta AI\b')]
                ai = [key for key, pattern in rivals if re.search(pattern, title, re.I)]
                taskbar = d.intern_atom('_NET_WM_WINDOW_TYPE_DOCK') in prop(fg, '_NET_WM_WINDOW_TYPE', [])
            except Exception:
                pass
        input_regions.tick()
        data = {'fg': active, 'taskbar': taskbar, 'ai': ai, 'wins': wins, 'logical': False,
                'input': {'mode': 'shaped', 'rectangles': input_regions.count}}
        snapshot = json.dumps(data)
        if snapshot != last:
            emit(data)
            last = snapshot
        import select
        ready, _, _ = select.select([sys.stdin], [], [], 0.05)
        if ready:
            chunk = os.read(sys.stdin.fileno(), 65536)
            if not chunk:
                break
            stdin_buffer += chunk.decode('utf8')
            while '\n' in stdin_buffer:
                line, stdin_buffer = stdin_buffer.split('\n', 1)
                try:
                    cmd = json.loads(line)
                    valid = {w['id'] for w in wins}
                    if cmd.get('command') == 'input-regions':
                        input_regions.refresh(cmd.get('rects'), cmd.get('viewport'))
                    elif cmd.get('command') == 'close':
                        for wid in cmd.get('ids', []):
                            if wid not in valid:
                                continue
                            event = protocol.event.ClientMessage(window=int(wid),
                                client_type=d.intern_atom('_NET_CLOSE_WINDOW'), data=(32, [0, 2, 0, 0, 0]))
                            root.send_event(event, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
                        d.flush()
                except (ValueError, TypeError):
                    pass
    input_regions.close()


if __name__ == '__main__':
    try:
        if sys.argv[1] == '--prepare-overlay':
            prepare_overlay(int(sys.argv[2]), int(sys.argv[3]))
        else:
            parent = int(sys.argv[1])
            if 'KDE' in os.environ.get('XDG_CURRENT_DESKTOP', '').upper():
                kwin(parent, int(sys.argv[2]))
            elif os.environ.get('XDG_SESSION_TYPE') == 'x11':
                x11(parent, int(sys.argv[2]))
            else:
                raise RuntimeError('Window tracking requires KDE Plasma 6 or an X11 session')
    except Exception as exc:
        print('[capri] Linux desktop bridge: ' + str(exc), file=sys.stderr)
        sys.exit(1)
