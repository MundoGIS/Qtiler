const t="fir",a=401,e={target:"toolbar",visibleAtStart:!0,visibleForGroups:[],maxFeatures:1e4,mappings:{geometryField:"geom"},wfsLayers:[{id:"1246",idField:"fnr",areaField:"omrade",caption:"Fastighetsbeteckning",url:"https://x",layers:["x:x"],searchFields:["fastbet"],displayFields:["fastbet"],geometryField:"geom",visibleForGroups:[]},{id:"1248",idField:"fnr",areaField:"omrade",caption:"Ägare",url:"https://x",layers:["x:x"],searchFields:["namn"],aliasDict:'{"fnr":"FNR"}',displayFields:["fastighet"],geometryField:"geom",visibleForGroups:[]},{id:"1249",idField:"nyckel",areaField:"omrade",caption:"Adress",url:"https://x",layers:["x:x"],searchFields:["adress"],aliasDict:"",displayFields:["fastbet"],geometryField:"geom",visibleForGroups:[]},{id:"1247",caption:"Kommuninvånare",url:"https://x",layers:["x:x"],searchFields:["tillnamn"],aliasDict:"",displayFields:["tillnamn"],geometryField:"geom",visibleForGroups:[]}],wmsRealEstateLayer:{id:"9999",areaField:"omrade",idField:"fnr"},wfsRealEstateLayer:{id:"1246",areaField:"omrade",geometryField:"geom",idField:"fnr",labelField:"block_enhet",maxFeatures:"10000",caption:"Fastighetsbeteckning",url:"https://x",layers:["x:x"],searchFields:["fastbet"],displayFields:["fastbet"]},resultsList:{sortByField:"fastbet",textField:"fastbet",template:`<div>
        <table>
          <tbody>
            <tr>
              <td>Fastighet</td>
              <td>{fastbet}</td>
            </tr>
            <tr>
              <td>Område</td>
              <td>{omrade}</td>
            </tr>
            <tr>
              <td>Ägare</td>
              <td>{namn1}</td>
            </tr>
            <tr>
              <td>Ägare</td>
              <td>{namn2}</td>
            </tr>
            <tr>
              <td>Ägare</td>
              <td>{namn3}</td>
            </tr>
            <tr>
              <td>Notering ägare</td>
              <td>{agare_notering}</td>
            </tr>
            <tr>
              <td>Fastighetsadress</td>
              <td>{fastighetsadress}</td>
            </tr>
            <tr>
              <td>Registrerad totalarea (m2)</td>
              <td>{totalarea}</td>
            </tr>
          </tbody>
        </table>
        <ul>
          <li>
            <a href="https://x/Report/Fastighetenkel/pdf/{fnr}" target="_blank">
              Fastighetsrapport (förenklad)
            </a>
          </li>
          <li>
            <a href="https://x/Report/Fastighet/pdf/{fnr}" target="_blank">
              Fastighetsrapport (komplett)
            </a>
          </li>
          <li>
            <a href="https://x/?fnr={fnr}&fastighet={fastbet}" target="_blank">
              Bygglovsanteckning
            </a>
          </li>
        </ul>
      </div>`},propertyList:{idField:"fnr",excelExportUrl:"https://x/mapservice/fir/realEstateOwnerlist",visibleForGroups:[]},residentList:{mappings:{addressDisplayName:"Adress",addressFieldName:"adress",ageDisplayName:"Ålder",ageFieldName:"alder",ssnDisplayName:"Personnummer",ssnFieldName:"personnr",birthDateDisplayName:"Födelsedatum",birthDateFieldName:"personnr",genderDisplayName:"Kön",genderFieldName:"koen",nameDisplayName:"Namn",nameFieldName:"tillnamn",postalCodeDisplayName:"Postnummer",postalCodeFieldName:"postnr",cityDisplayName:"Postort",cityFieldName:"ort"},id:"9247",excelExportUrl:"https://x/mapservice/fir/residentlist",minAge:0,visibleForGroups:[]},edp:{url:"https://x/mapservice/edp/SendRealEstateIdentifiers",idField:"fnr",designationField:"fastbet",visibleForGroups:[]}},r={type:"fir",index:401,options:e};export{r as default,a as index,e as options,t as type};
