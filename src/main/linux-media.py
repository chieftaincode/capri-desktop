#!/usr/bin/env python3
"""Media controls using the standard MPRIS interface; never simulates typing."""
import sys
import dbus

action = {'play': 'Play', 'pause': 'Pause', 'next': 'Next', 'previous': 'Previous'}[sys.argv[1]]
bus = dbus.SessionBus()
players = []
for name in bus.list_names():
    if not name.startswith('org.mpris.MediaPlayer2.'):
        continue
    try:
        obj = bus.get_object(name, '/org/mpris/MediaPlayer2')
        props = dbus.Interface(obj, 'org.freedesktop.DBus.Properties')
        status = props.Get('org.mpris.MediaPlayer2.Player', 'PlaybackStatus')
        players.append((status == 'Playing', str(name), obj))
    except dbus.DBusException:
        continue
if not players:
    sys.exit('No MPRIS media player is running')
players.sort(key=lambda item: (not item[0], item[1]))
getattr(dbus.Interface(players[0][2], 'org.mpris.MediaPlayer2.Player'), action)()
