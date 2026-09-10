import Link from "next/link";
import { SiteFooter } from "./components/ui/PageKit";
import styles from "./home.module.css";

const groups = [
  { title: "工具", english: "TOOLS", links: [
    { href: "/calc", title: "记账", detail: "每天的收支，一笔一笔记清楚", english: "CALCULATOR" },
    { href: "/secret", title: "密笺", detail: "留给彼此的私密文字", english: "SECRET" },
  ] },
  { title: "内容", english: "COLLECTION", links: [
    { href: "/books", title: "书架", detail: "翻阅与收藏", english: "BOOKS" },
    { href: "/photos", title: "相册", detail: "留住日常的片刻", english: "PHOTOS" },
    { href: "/principles", title: "原则", detail: "关系中的共识与边界", english: "PRINCIPLES" },
    { href: "/rgsdoc", title: "RGS 文档", detail: "状态灯的安装与使用", english: "RGS DOC" },
  ] },
];
const services = [
  { href: "/docs/", title: "DOCS", detail: "公共文档" },
  { href: "/frp/", title: "FRP", detail: "内网访问" },
  { href: "http://yinlubin.cn:6080", title: "OPENWRT", detail: "路由管理" },
  { href: "http://yinlubin.cn:6002", title: "RPI", detail: "树莓派" },
];

export default function Home() {
  return (
    <main className={`site-page ${styles.page}`}>
      <div className={styles.container}>
        <header className={styles.identity}>
          <p className={styles.kicker}>PERSONAL SPACE</p>
          <h1>LUBIN YIN</h1>
          <p className={styles.tagline}>Engineer · Builder · Minimalist</p>
          <address className={styles.contact}>
            <a href="tel:13718231649"><span>tel</span>13718231649</a>
            <a href="mailto:yinlubin1989@gmail.com"><span>mail</span>yinlubin1989@gmail.com</a>
            <p><span>loc</span>北京市石景山区古城</p>
          </address>
        </header>
        <nav aria-label="网站导航" className={styles.navigation}>
          {groups.map((group) => (
            <section className={styles.group} key={group.title} aria-label={group.title}>
              <h2 className={styles.groupTitle}>{group.title}<span>{group.english}</span></h2>
              <div className={styles.links}>
                {group.links.map((link) => (
                  <Link href={link.href} key={link.href} className={styles.link}>
                    <span className={styles.linkHeading}><span>{link.title}</span><span className={styles.arrow} aria-hidden="true">↗</span></span>
                    <span className={styles.detail}>{link.detail}</span>
                    <span className={styles.english}>{link.english}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
          <section className={styles.group} aria-label="服务">
            <h2 className={styles.groupTitle}>服务<span>SERVICES</span></h2>
            <div className={styles.services}>
              {services.map((service) => <a key={service.href} href={service.href} className={styles.service}><span>{service.title}</span><span>{service.detail}</span></a>)}
            </div>
          </section>
        </nav>
        <SiteFooter />
      </div>
    </main>
  );
}
