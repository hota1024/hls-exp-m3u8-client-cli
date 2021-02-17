import * as dotenv from 'dotenv'
dotenv.config()
import * as npath from 'path'
import * as fs from 'fs-extra'
import { fetchM3u8 } from './M3u8'
import axios from 'axios'
import * as axiosRetry from 'axios-retry'
import { joinURL } from 'ufo'
import { Decoder } from 'ts-coder'
import { waitFor } from './waitFor'
// eslint-disable-next-line @typescript-eslint/ban-types
// eslint-disable-next-line @typescript-eslint/ban-types
;((axiosRetry as unknown) as Function)(axios, { retries: 3 })
import { getPathDetails } from './getPathDetails'

let allPaths = 0
let numOfProcess = 0
const pathQueue: string[] = []
const states = new Map<
  number,
  Map<
    number,
    {
      decoder: Decoder
      tsList: Map<number, Buffer>
    }
  >
>()

const api = process.env.API
const jwt = process.env.JWT
const cwd = process.cwd()
const camerasPath = npath.join(cwd, 'cameras')
let allStartAt = 0

axios.defaults.headers.common['Authorization'] = `Bearer ${jwt}`

async function startQueue(threads: number) {
  if (pathQueue.length === 0) {
    setTimeout(startQueue, 1)
    return
  }

  while (pathQueue.length > 0) {
    const path = pathQueue.shift()
    const details = getPathDetails(path)
    const url = joinURL(api, 'api/streams', path)

    if (!states.has(details.camera)) {
      // set camera
      states.set(details.camera, new Map())
    }
    const cameraState = states.get(details.camera)

    if (!cameraState.has(details.frame)) {
      const decoder = new Decoder({
        headSize: 4,
        isEnd(head) {
          return head[0] === 0x02
        },
      })

      // set frame
      cameraState.set(details.frame, {
        decoder,
        tsList: new Map(),
      })
    }
    const frameState = cameraState.get(details.frame)

    numOfProcess++
    axios
      .get(url, {
        responseType: 'arraybuffer',
      })
      .then((r) => {
        numOfProcess--
        frameState.tsList.set(details.tsIndex, r.data)
      })

    while (numOfProcess >= threads) {
      await waitFor(1)
    }
  }

  while (numOfProcess > 0) {
    await waitFor(1)
  }

  for (const [cameraId, camera] of states.entries()) {
    for (const [frameNumber, frame] of camera.entries()) {
      const sortedKeys = [...frame.tsList.keys()].sort((a, b) => a - b)
      frame.decoder.onData((buffer) => {
        if (frameNumber === 100) {
          console.log(`end: ${Date.now() - allStartAt}ms`)
        }
        fs.writeFile(
          npath.join(camerasPath, `${cameraId}/${frameNumber}.bin`),
          buffer
        )
      })
      sortedKeys
        .map((k) => frame.tsList.get(k))
        .forEach((b) => frame.decoder.push(b))
    }
  }

  setTimeout(startQueue, 0)
}

async function startWatch(cameraId: number, threads: number) {
  const dirPath = npath.join(camerasPath, cameraId.toString())
  if (fs.pathExistsSync(dirPath)) {
    await fs.remove(dirPath)
    console.log(`removed: ${dirPath}`)
  }
  fs.mkdirSync(dirPath)
  const url = joinURL(api, 'api/streams')
  const m3u8Url = `${url}/${cameraId}.m3u8`

  /**
   * - 読み込み済みの ts のパス
   */
  const loadedPaths: string[] = []

  /**
   * 1. 33ms以下で生成すること
   * 2. 並列で生成を行うこと
   * 3. pathsの重複処理が行われていること
   */

  let isReady = false

  while (true as const) {
    /**
     * - 最大 100 件の ts へのパスが記載されている
     */
    const m3u8 = await fetchM3u8(m3u8Url)

    if (!isReady) {
      console.log(`watching ${m3u8Url}`)
      isReady = true
      allStartAt = Date.now()
      startQueue(threads)
    }

    allPaths = Math.max(allPaths, m3u8.paths.length)

    /**
     * - 重複排除
     */
    const paths = m3u8.paths.filter((p) => !loadedPaths.includes(p))
    loadedPaths.push(...paths)

    if (paths.length === 0) {
      continue
    }

    pathQueue.push(...paths)
  }
}

startWatch(
  parseInt(process.argv[2]),
  process.argv[3] ? parseInt(process.argv[3]) : 1
)

// ;(async () => {
//   const urls: string[] = []

//   for (let i = 0; i < 11; ++i) {
//     urls.push(`http://3.112.70.1:8000/api/streams/1/1/${i}.ts`)
//   }
//   console.log(urls)

//   const promises = urls.map((url) =>
//     axios.get(url, {
//       responseType: 'arraybuffer',
//       headers: {
//         Authorization: `Bearer ${jwt}`,
//       },
//     })
//   )

//   console.time('requests')
//   await Promise.all(promises)
//   console.timeEnd('requests')
// })()
