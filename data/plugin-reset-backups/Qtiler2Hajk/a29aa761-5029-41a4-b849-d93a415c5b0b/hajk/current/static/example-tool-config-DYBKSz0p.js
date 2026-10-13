const t="kir",a=4009,e={target:"toolbar",visibleAtStart:!0,wfsLayers:[{id:"1247",caption:"Kommuninvånare",url:"https://x",layers:["ext_skv_v1:kir_folk"],searchFields:["tillnamn"],aliasDict:"",displayFields:["tillnamn"],geometryField:"geom",visibleForGroups:[]}],wfsId:"1247",genderField:"koen",genderMale:"M",genderFemale:"K",ageField:"alder",maxFeatures:1e4,resultsList:{sortByField:"ageField",textField:"tillnamn",template:`<div>
  <table>
    <tbody>
      <tr>
        <td>Namn</td>
        <td>{tillnamn}</td>
      </tr>
      <tr>
        <td>Adress</td>
        <td>{adress}<br/>{postnr}<br/>{ort}</td>
      </tr>
      <tr>
        <td>Födelsedatum</td>
        <td>{fodelsedat|date}</td>
      </tr>
    </tbody>
  </table>
</div>`},residentList:{mappings:{addressDisplayName:"Adress",addressFieldName:"adress",ageDisplayName:"Ålder",ageFieldName:"alder",ssnDisplayName:"Personnummer",ssnFieldName:"personnr",birthDateDisplayName:"Födelsedatum",birthDateFieldName:"personnr",genderDisplayName:"Kön",genderFieldName:"koen",nameDisplayName:"Namn",nameFieldName:"tillnamn",postalCodeDisplayName:"Postnummer",postalCodeFieldName:"postnr",cityDisplayName:"Postort",cityFieldName:"ort"},id:"9247",excelExportUrl:"https://x/mapservice/fir/residentlist",minAge:0,visibleForGroups:[]}},s={type:"kir",index:4009,options:e};export{s as default,a as index,e as options,t as type};
