export function model(label = "Service", style = "rounded=1;whiteSpace=wrap;html=1;") {
  return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="service" value="${label}" style="${style}" vertex="1" parent="1"><mxGeometry x="40" y="40" width="160" height="80" as="geometry"/></mxCell></root></mxGraphModel>`;
}
export const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#0078d4"/></svg>');
