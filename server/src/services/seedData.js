export function buildSeedFiles(site) {
  const siteRoot = `/sites/${site.siteCode}`;
  const siteDbRoot = `${siteRoot}/siteDB`;
  const usersDbRoot = `${siteRoot}/siteUsersDb`;
  const assetsRoot = `${siteDbRoot}/siteAssets`;
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

  return [
    { path: `${assetsRoot}/bihs_master_config_v1.txt`, content: json({ schemaVersion: '1.0.0' }) },
    { path: `${assetsRoot}/users_data.txt`, content: json([]) },
    { path: `${assetsRoot}/events_data.txt`, content: json({ displayCount: 3, displayMode: 'default', events: [] }) },
    { path: `${assetsRoot}/nav_data.txt`, content: json([]) },
    { path: `${assetsRoot}/site_content_data.txt`, content: json({}) },
    { path: `${assetsRoot}/theme_data.txt`, content: json({}) },
    { path: `${assetsRoot}/external_links_data.txt`, content: json([]) },
    {
      path: `${assetsRoot}/gantt_data.txt`,
      content: json({ enabled: false, buttonLabel: 'גאנט עבודה', pageTitle: 'גאנט עבודה', description: '', groupBy: 'category', defaultView: 'month', showLegend: true, showToday: true, categories: [], items: [] }),
    },
    { path: `${usersDbRoot}/widgets_data.txt`, content: json({}) },
  ];
}
