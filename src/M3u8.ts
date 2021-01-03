import axios from 'axios'

/**
 * M3u8 type.
 */
export type M3u8 = {
  duration: number
  sequence: number
  paths: string[]
}

/**
 * parse `#EXT-X-*` number value.
 */
export const parseExtNum = (lines: string[], key: string): number => {
  const exp = new RegExp(`^#EXT-X-${key}: ?(-?\\d+)$`)
  const line = lines.find((l) => l.match(exp))

  if (!line) {
    throw new Error(`${key} not found in the m3u8`)
  }

  return Number(line.match(exp)[1])
}

/**
 * parse paths.
 */
export const parsePaths = (lines: string[]): string[] => {
  const paths: string[] = []

  lines.forEach((l, i) => {
    if (l.startsWith('#EXTINF')) {
      paths.push(lines[i + 1])
    }
  })

  return paths
}

/**
 * parse a m3u8 string.
 */
export const parseM3u8 = (input: string): M3u8 => {
  const lines = input.split('\n')

  const duration = parseExtNum(lines, 'TARGETDURATION')
  const sequence = parseExtNum(lines, 'MEDIA-SEQUENCE')
  const paths = parsePaths(lines)

  return {
    duration,
    sequence,
    paths,
  }
}

/**
 * fetch a m3u8.
 */
export async function fetchM3u8(url: string): Promise<M3u8> {
  const res = await axios.get(url)

  return parseM3u8(res.data)
}
