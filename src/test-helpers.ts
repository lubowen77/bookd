import AdmZip from 'adm-zip'

export const makeTestEpub = () => {
  const zip = new AdmZip()
  zip.addFile('mimetype', Buffer.from('application/epub+zip'))
  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`))
  zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试群鸟</dc:title><dc:creator>测试作者</dc:creator><dc:language>zh-CN</dc:language></metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
    </package>`))
  zip.addFile('OEBPS/nav.xhtml', Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="chapter1.xhtml">第一章 相遇</a></li><li><a href="chapter2.xhtml">第二章 群飞</a></li></ol></nav></body></html>`))
  zip.addFile('OEBPS/chapter1.xhtml', Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章 相遇</h1><p>一群椋鸟在黄昏相遇。</p><script>window.bad = true</script></body></html>`))
  zip.addFile('OEBPS/chapter2.xhtml', Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第二章 群飞</h1><p>局部互动形成复杂的整体秩序。</p></body></html>`))
  return zip.toBuffer()
}
