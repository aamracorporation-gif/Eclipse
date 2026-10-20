import {Redirect,useLocalSearchParams} from 'expo-router';
import {pathFor,sectionFor} from '@/src/domain/navigation';
export default function Legacy(){const {section}=useLocalSearchParams<{section:string}>();return <Redirect href={pathFor('player',sectionFor('player',section)) as any}/>;}
