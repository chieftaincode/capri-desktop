"""A leased X11 input shape. Transparent desktop areas never accept clicks."""
import math
import time


class InputRegions:
    def __init__(self, apply, geometry, clock=time.monotonic, close=lambda: None):
        self.apply = apply
        self.geometry = geometry
        self.clock = clock
        self.close = close
        self.rects = []
        self.viewport = (1, 1)
        self.updated = -math.inf
        self.count = 0
        self.tick()

    @classmethod
    def open(cls, window_id, parent_pid):
        from Xlib import X, Xatom, display
        from Xlib.ext import shape
        connection = display.Display()
        try:
            window = connection.create_resource_object('window', window_id)
            owner = window.get_full_property(connection.intern_atom('_NET_WM_PID'), Xatom.CARDINAL)
            if owner is None or len(owner.value) != 1 or int(owner.value[0]) != parent_pid:
                raise RuntimeError('Input shape window is not owned by Capri')
            if not connection.has_extension('SHAPE'):
                raise RuntimeError('X11 SHAPE extension is unavailable')

            def apply(rectangles):
                window.shape_rectangles(shape.SO.Set, shape.SK.Input, X.Unsorted, 0, 0, rectangles)
                connection.flush()

            def geometry():
                size = window.get_geometry()
                return size.width, size.height

            return cls(apply, geometry, close=connection.close)
        except Exception:
            connection.close()
            raise

    def refresh(self, rectangles, viewport):
        if not isinstance(rectangles, list) or len(rectangles) > 1024:
            return
        if not isinstance(viewport, list) or len(viewport) != 2:
            return
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) or not 1 <= v <= 32767 for v in viewport):
            return
        self.viewport = tuple(viewport)
        self.rects = rectangles
        self.updated = self.clock()

    def tick(self):
        rectangles = []
        if self.clock() - self.updated < 0.5:
            width, height = self.geometry()
            sx, sy = width / self.viewport[0], height / self.viewport[1]
            for rect in self.rects:
                if not isinstance(rect, list) or len(rect) != 4:
                    continue
                if any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in rect):
                    continue
                x, y, w, h = rect
                # Reject an accidental whole-overlay rectangle as well as invalid sizes.
                if w <= 0 or h <= 0 or (w >= self.viewport[0] * 0.9 and h >= self.viewport[1] * 0.9):
                    continue
                left, top = max(0, math.floor(x * sx)), max(0, math.floor(y * sy))
                right, bottom = min(width, math.ceil((x + w) * sx)), min(height, math.ceil((y + h) * sy))
                if right > left and bottom > top:
                    rectangles.append((left, top, right - left, bottom - top))
        self.apply(rectangles)
        self.count = len(rectangles)
        return True
