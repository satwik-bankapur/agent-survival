/*
 * `<line>` in JSX is the SVG element, so R3F types three's Line as
 * `<threeLine>`; the element itself has to be registered. Import this module
 * for its side effect wherever `<threeLine>` is used.
 */

import { extend } from '@react-three/fiber'
import { Line } from 'three'

extend({ ThreeLine: Line })
