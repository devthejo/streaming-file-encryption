import crypto from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { decryptFile, encryptFile } from './index'
import { rebuffer } from './streams'
import { decodeHex } from './tests/codec'
import { expectOutputSequence, observe, sourceStream } from './tests/streams'

const __4kiB = 4_096
const __8kiB = 8_192
const _16kiB = 16_384
const _32kiB = 32_768
const _64kiB = 65_536

describe('complete encryption/decryption flow', () => {
  test('happy path', async () => {
    const mainSecret = crypto.randomBytes(64)
    const spy = jest.fn()
    const source = sourceStream([_64kiB, _64kiB])
    const sink = createWriteStream('/dev/null')
    await pipeline(
      source,
      encryptFile(mainSecret, 'ctx'),
      decryptFile(mainSecret, 'ctx'),
      observe(spy),
      sink
    )
    expectOutputSequence(spy, [
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
    ])
  })

  test('robustness to rebuffering', async () => {
    const mainSecret = crypto.randomBytes(64)
    const spy = jest.fn()
    const source = sourceStream([_64kiB, _64kiB])
    const sink = createWriteStream('/dev/null')
    await pipeline(
      source,
      encryptFile(mainSecret, 'ctx'),
      rebuffer(0, __8kiB),
      decryptFile(mainSecret, 'ctx'),
      observe(spy),
      sink
    )
    expectOutputSequence(spy, [
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
    ])
  })

  test('decryption failure - incorrect context', async () => {
    const mainSecret = crypto.randomBytes(64)
    const spy = jest.fn()
    const source = sourceStream([_64kiB, _64kiB])
    const sink = createWriteStream('/dev/null')
    await expect(() =>
      pipeline(
        source,
        encryptFile(mainSecret, 'happy path'),
        decryptFile(mainSecret, 'sad path'),
        observe(spy),
        sink
      )
    ).rejects.toThrow()
    expect(spy).not.toHaveBeenCalled()
  })

  test('decryption failure - incorrect main secret', async () => {
    const mainSecretA = crypto.randomBytes(64)
    const mainSecretB = crypto.randomBytes(64)
    const spy = jest.fn()
    const source = sourceStream([_64kiB, _64kiB])
    const sink = createWriteStream('/dev/null')
    await expect(() =>
      pipeline(
        source,
        encryptFile(mainSecretA, 'ctx'),
        decryptFile(mainSecretB, 'ctx'),
        observe(spy),
        sink
      )
    ).rejects.toThrow()
    expect(spy).not.toHaveBeenCalled()
  })

  test('known vector - antiregression', async () => {
    const mainSecret = decodeHex(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    )
    const context = 'context'
    // Generated with:
    // const source = sourceStream([_64kiB, _64kiB])
    // await pipeline(source, createWriteStream('cleartext.bin'))
    // await pipeline(
    //   createReadStream('cleartext.bin'),
    //   encryptFile(mainSecret, context),
    //   createWriteStream('ciphertext.bin')
    // )
    const spy = jest.fn()
    await pipeline(
      createReadStream('ciphertext.bin'),
      decryptFile(mainSecret, context),
      observe(spy),
      createWriteStream('decrypted.bin')
    )
    expectOutputSequence(spy, [
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
      _16kiB,
    ])
  })

  test('single block file format', async () => {
    const mainSecret = crypto.randomBytes(64)
    const spy = jest.fn()
    const source = sourceStream([__4kiB])
    const sink = createWriteStream('/dev/null')
    await pipeline(source, encryptFile(mainSecret, 'ctx'), observe(spy), sink)
    expect(spy).toHaveBeenCalledTimes(6)
    // Header
    expect(spy.mock.calls[0][0].byteLength).toEqual(4)
    expect(spy.mock.calls[1][0].byteLength).toEqual(12)
    expect(spy.mock.calls[2][0].byteLength).toEqual(32)
    // Block 1
    expect(spy.mock.calls[3][0].byteLength).toEqual(2 + _16kiB)
    expect(spy.mock.calls[4][0].byteLength).toEqual(16)
    // HMAC
    expect(spy.mock.calls[5][0].byteLength).toEqual(64)
  })

  test('two block file format', async () => {
    const mainSecret = crypto.randomBytes(64)
    const spy = jest.fn()
    const source = sourceStream([_16kiB, __8kiB, __4kiB])
    const sink = createWriteStream('/dev/null')
    await pipeline(source, encryptFile(mainSecret, 'ctx'), observe(spy), sink)
    expect(spy).toHaveBeenCalledTimes(8)
    // Header
    expect(spy.mock.calls[0][0].byteLength).toEqual(4)
    expect(spy.mock.calls[1][0].byteLength).toEqual(12)
    expect(spy.mock.calls[2][0].byteLength).toEqual(32)
    // Block 1
    expect(spy.mock.calls[3][0].byteLength).toEqual(2 + _16kiB)
    expect(spy.mock.calls[4][0].byteLength).toEqual(16)
    // Block 2
    expect(spy.mock.calls[5][0].byteLength).toEqual(2 + _16kiB)
    expect(spy.mock.calls[6][0].byteLength).toEqual(16)
    // HMAC
    expect(spy.mock.calls[7][0].byteLength).toEqual(64)
  })
})
