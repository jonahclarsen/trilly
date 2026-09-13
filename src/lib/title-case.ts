const minorWords = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'via', 'vs'])

export function titleCase(name: string): string {
  const lower = name.toLowerCase()
  const words = [...lower.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)]
  let index = 0
  return lower.replace(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu, (word, offset: number) => {
    const position = index++
    // Keep connected domain suffixes lowercase (Amazon.com, Amazon.co.uk).
    if (/[\p{L}\p{N}]\.$/u.test(lower.slice(0, offset))) return word
    if (word === 'bc') return 'BC'
    return position > 0 && position < words.length - 1 && minorWords.has(word)
      ? word
      : word.replace(/\p{L}/u, letter => letter.toUpperCase())
  })
}
