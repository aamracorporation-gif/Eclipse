import {Redirect,useLocalSearchParams} from 'expo-router';
import {competitionPath,pathFor,type Space} from '@/src/domain/navigation';
export function LegacySpaceRedirect({space,section}:{space:Space;section:string}){
 const {competition,id}=useLocalSearchParams<{competition?:string;id?:string}>();
 const selected=competition||id;
 return <Redirect href={(selected?competitionPath(space,selected):pathFor(space,section)) as any}/>;
}
