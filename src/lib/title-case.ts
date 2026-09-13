const minorWords = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'via', 'vs'])

export function titleCase(name: string): string {
  const lower = name.toLowerCase()
  const words = [...lower.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)]
  let index = 0
  return lower.replace(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu, word => {
    const position = index++
    return position > 0 && position < words.length - 1 && minorWords.has(word)
      ? word
      : word.replace(/\p{L}/u, letter => letter.toUpperCase())
  })
}
